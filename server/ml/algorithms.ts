export interface RidgeRegressionArtifact {
  weights: number[];
  intercept: number;
  means: number[];
  stds: number[];
}

export interface TreeNode {
  isLeaf: boolean;
  value: number;
  featureIdx?: number;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
}

export interface RandomForestArtifact {
  trees: TreeNode[];
  nFeatures: number;
  impurityImportance: number[];
  hyperparameters: {
    nEstimators: number;
    maxDepth: number;
    minSamplesLeaf: number;
  };
}

function createSeededRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function computeMetrics(yTrue: number[], yPred: number[]): { mae: number; rmse: number; r2: number } {
  const n = yTrue.length;
  if (n === 0) return { mae: 0, rmse: 0, r2: 0 };
  let absSum = 0;
  let sqSum = 0;
  const meanTrue = yTrue.reduce((a, b) => a + b, 0) / n;
  let totalVar = 0;

  for (let i = 0; i < n; i++) {
    const err = yTrue[i] - yPred[i];
    absSum += Math.abs(err);
    sqSum += err * err;
    totalVar += (yTrue[i] - meanTrue) ** 2;
  }

  const mae = absSum / n;
  const rmse = Math.sqrt(sqSum / n);
  const r2 = totalVar > 1e-9 ? 1 - sqSum / totalVar : 0;

  return {
    mae: Number(mae.toFixed(3)),
    rmse: Number(rmse.toFixed(3)),
    r2: Number(r2.toFixed(4)),
  };
}

/**
 * Solves regularized Ridge Linear Regression on standardized features via Gauss-Jordan elimination.
 */
export function trainRidgeRegression(X: number[][], y: number[], alpha = 1.0): RidgeRegressionArtifact {
  const n = X.length;
  const p = X[0].length;

  const means = new Array<number>(p).fill(0);
  const stds = new Array<number>(p).fill(1);

  for (let j = 0; j < p; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i][j];
    means[j] = s / n;

    let v = 0;
    for (let i = 0; i < n; i++) v += (X[i][j] - means[j]) ** 2;
    stds[j] = Math.sqrt(v / n) || 1;
  }

  const yMean = y.reduce((a, b) => a + b, 0) / n;
  const Xs = X.map((row) => row.map((val, j) => (val - means[j]) / stds[j]));

  // Build (X^T X + alpha * I) and X^T (y - yMean)
  const A: number[][] = Array.from({ length: p }, () => new Array<number>(p + 1).fill(0));
  for (let j = 0; j < p; j++) {
    for (let k = 0; k < p; k++) {
      let dot = 0;
      for (let i = 0; i < n; i++) dot += Xs[i][j] * Xs[i][k];
      A[j][k] = dot + (j === k ? alpha : 0);
    }
    let rhs = 0;
    for (let i = 0; i < n; i++) rhs += Xs[i][j] * (y[i] - yMean);
    A[j][p] = rhs;
  }

  // Gauss-Jordan elimination with partial pivoting
  for (let col = 0; col < p; col++) {
    let maxRow = col;
    for (let row = col + 1; row < p; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row;
    }
    [A[col], A[maxRow]] = [A[maxRow], A[col]];

    const pivot = A[col][col];
    if (Math.abs(pivot) < 1e-12) continue;
    for (let k = col; k <= p; k++) A[col][k] /= pivot;

    for (let row = 0; row < p; row++) {
      if (row === col) continue;
      const factor = A[row][col];
      for (let k = col; k <= p; k++) A[row][k] -= factor * A[col][k];
    }
  }

  const weights = A.map((row) => Number(row[p].toFixed(6)));
  return {
    weights,
    intercept: Number(yMean.toFixed(6)),
    means: means.map((m) => Number(m.toFixed(6))),
    stds: stds.map((s) => Number(s.toFixed(6))),
  };
}

export function predictRidgeRegression(model: RidgeRegressionArtifact, row: number[]): number {
  let pred = model.intercept;
  for (let j = 0; j < model.weights.length; j++) {
    const z = (row[j] - model.means[j]) / (model.stds[j] || 1);
    pred += model.weights[j] * z;
  }
  return Math.max(0, pred);
}

/**
 * Trains an ensemble Random Forest Regressor using bootstrap aggregation,
 * random feature subsampling at each split, and exact variance-reduction CART nodes.
 */
export function trainRandomForest(
  X: number[][],
  y: number[],
  options: { nEstimators?: number; maxDepth?: number; minSamplesLeaf?: number; seed?: number } = {}
): RandomForestArtifact {
  const nEstimators = Math.min(80, Math.max(10, options.nEstimators ?? 35));
  const maxDepth = Math.min(14, Math.max(3, options.maxDepth ?? 8));
  const minSamplesLeaf = Math.min(20, Math.max(2, options.minSamplesLeaf ?? 4));
  const rng = createSeededRng(options.seed ?? 42026);

  const n = X.length;
  const nFeatures = X[0].length;
  const maxFeaturesPerSplit = Math.max(2, Math.ceil(nFeatures * 0.65));
  const impurityGains = new Array<number>(nFeatures).fill(0);

  const sampleFeatureSubset = (): number[] => {
    const indices = Array.from({ length: nFeatures }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices.slice(0, maxFeaturesPerSplit);
  };

  const buildTree = (indices: number[], depth: number): TreeNode => {
    const count = indices.length;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < count; i++) {
      const val = y[indices[i]];
      sum += val;
      sumSq += val * val;
    }
    const mean = sum / count;
    const parentSse = sumSq - (sum * sum) / count;

    if (depth >= maxDepth || count < minSamplesLeaf * 2 || parentSse < 1e-7) {
      return { isLeaf: true, value: Number(mean.toFixed(4)) };
    }

    const candidateFeatures = sampleFeatureSubset();
    let bestGain = 0;
    let bestFeat = -1;
    let bestThreshold = 0;
    let bestLeft: number[] = [];
    let bestRight: number[] = [];

    for (const fIdx of candidateFeatures) {
      // Sort sample indices by feature value
      const sortedIdx = [...indices].sort((a, b) => X[a][fIdx] - X[b][fIdx]);
      const minVal = X[sortedIdx[0]][fIdx];
      const maxVal = X[sortedIdx[count - 1]][fIdx];
      if (maxVal - minVal < 1e-9) continue;

      let leftSum = 0;
      let leftSumSq = 0;

      // Evaluate split positions using stride for fast exact quantile scanning on large nodes
      const step = count > 160 ? Math.floor(count / 40) : 1;

      for (let i = 0; i < count - minSamplesLeaf; i++) {
        const yVal = y[sortedIdx[i]];
        leftSum += yVal;
        leftSumSq += yVal * yVal;

        const leftCount = i + 1;
        if (leftCount < minSamplesLeaf) continue;
        if (step > 1 && i % step !== 0 && i !== count - minSamplesLeaf - 1) continue;

        const currX = X[sortedIdx[i]][fIdx];
        const nextX = X[sortedIdx[i + 1]][fIdx];
        if (nextX - currX < 1e-9) continue;

        const rightCount = count - leftCount;
        const rightSum = sum - leftSum;
        const rightSumSq = sumSq - leftSumSq;

        const leftSse = Math.max(0, leftSumSq - (leftSum * leftSum) / leftCount);
        const rightSse = Math.max(0, rightSumSq - (rightSum * rightSum) / rightCount);
        const gain = parentSse - (leftSse + rightSse);

        if (gain > bestGain) {
          bestGain = gain;
          bestFeat = fIdx;
          bestThreshold = (currX + nextX) / 2;
        }
      }
    }

    if (bestFeat === -1 || bestGain <= 1e-6) {
      return { isLeaf: true, value: Number(mean.toFixed(4)) };
    }

    bestLeft = [];
    bestRight = [];
    for (let i = 0; i < count; i++) {
      const idx = indices[i];
      if (X[idx][bestFeat] <= bestThreshold) bestLeft.push(idx);
      else bestRight.push(idx);
    }

    if (bestLeft.length < minSamplesLeaf || bestRight.length < minSamplesLeaf) {
      return { isLeaf: true, value: Number(mean.toFixed(4)) };
    }

    impurityGains[bestFeat] += bestGain;

    return {
      isLeaf: false,
      value: Number(mean.toFixed(4)),
      featureIdx: bestFeat,
      threshold: Number(bestThreshold.toFixed(5)),
      left: buildTree(bestLeft, depth + 1),
      right: buildTree(bestRight, depth + 1),
    };
  };

  const trees: TreeNode[] = [];
  for (let t = 0; t < nEstimators; t++) {
    const bootIndices = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      bootIndices[i] = Math.floor(rng() * n);
    }
    trees.push(buildTree(bootIndices, 0));
  }

  const totalGain = impurityGains.reduce((a, b) => a + b, 0) || 1;
  const impurityImportance = impurityGains.map((g) => Number((g / totalGain).toFixed(4)));

  return {
    trees,
    nFeatures,
    impurityImportance,
    hyperparameters: { nEstimators, maxDepth, minSamplesLeaf },
  };
}

function predictSingleTree(node: TreeNode, row: number[]): number {
  let curr = node;
  while (!curr.isLeaf && curr.featureIdx !== undefined && curr.threshold !== undefined) {
    if (row[curr.featureIdx] <= curr.threshold) {
      curr = curr.left!;
    } else {
      curr = curr.right!;
    }
  }
  return curr.value;
}

export function predictRandomForest(forest: RandomForestArtifact, row: number[]): number {
  let sum = 0;
  for (let i = 0; i < forest.trees.length; i++) {
    sum += predictSingleTree(forest.trees[i], row);
  }
  return Math.max(0, sum / forest.trees.length);
}

export function predictRandomForestWithSpread(
  forest: RandomForestArtifact,
  row: number[]
): { mean: number; p25: number; p75: number; treeStd: number } {
  const preds = forest.trees.map((t) => predictSingleTree(t, row)).sort((a, b) => a - b);
  const n = preds.length;
  const mean = preds.reduce((a, b) => a + b, 0) / n;
  const variance = preds.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const p25 = preds[Math.floor(n * 0.25)] ?? mean;
  const p75 = preds[Math.floor(n * 0.75)] ?? mean;

  return {
    mean: Number(Math.max(0, mean).toFixed(2)),
    p25: Number(Math.max(0, p25).toFixed(2)),
    p75: Number(Math.max(0, p75).toFixed(2)),
    treeStd: Number(Math.sqrt(variance).toFixed(2)),
  };
}

/**
 * Computes held-out Permutation Feature Importance (increase in test MAE when feature j is shuffled).
 */
export function computePermutationImportance(
  forest: RandomForestArtifact,
  XTest: number[][],
  yTest: number[],
  baselineMae: number
): number[] {
  const rng = createSeededRng(98765);
  const n = XTest.length;
  const p = forest.nFeatures;
  const importances = new Array<number>(p).fill(0);

  for (let j = 0; j < p; j++) {
    const shuffledCol = XTest.map((r) => r[j]);
    for (let i = n - 1; i > 0; i--) {
      const k = Math.floor(rng() * (i + 1));
      [shuffledCol[i], shuffledCol[k]] = [shuffledCol[k], shuffledCol[i]];
    }

    let errSum = 0;
    for (let i = 0; i < n; i++) {
      const mutatedRow = [...XTest[i]];
      mutatedRow[j] = shuffledCol[i];
      const pred = predictRandomForest(forest, mutatedRow);
      errSum += Math.abs(yTest[i] - pred);
    }
    const permutedMae = errSum / n;
    importances[j] = Number(Math.max(0, permutedMae - baselineMae).toFixed(4));
  }

  return importances;
}
