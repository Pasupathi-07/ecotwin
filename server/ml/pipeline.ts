import fs from 'node:fs';
import path from 'node:path';
import type {
  AirQualityStandard,
  EvaluationPoint,
  FeatureBounds,
  FeatureImportanceItem,
  ModelMetrics,
  ObservationRow,
  ResidualBin,
} from '../../src/types/ecotwin.ts';
import { classifyPM25 } from '../stations.ts';
import {
  computeMetrics,
  computePermutationImportance,
  predictRandomForest,
  predictRandomForestWithSpread,
  predictRidgeRegression,
  trainRandomForest,
  trainRidgeRegression,
  type RandomForestArtifact,
  type RidgeRegressionArtifact,
} from './algorithms.ts';
import { getFeatureLabel, prepareChronologicalSplit } from './preprocess.ts';

export interface SerializedModelArtifact {
  version: string;
  modelName: string;
  algorithm: string;
  taskType: 'Contemporaneous Estimate' | 'Next-Step Lagged Forecast';
  target: string;
  unit: string;
  features: string[];
  imputerMedians: Record<string, number>;
  featureBounds: Record<string, FeatureBounds>;
  trainingPeriod: { start: string; end: string };
  testPeriod: { start: string; end: string };
  trainSize: number;
  testSize: number;
  datasetSize: number;
  metrics: ModelMetrics;
  featureImportance: FeatureImportanceItem[];
  limitations: string[];
  randomForest: RandomForestArtifact;
  ridgeBaseline: RidgeRegressionArtifact;
  createdAt: string;
}

export interface TrainPipelineOutput {
  artifact: SerializedModelArtifact;
  artifactPath: string;
  evaluationSeries: EvaluationPoint[];
  residualHistogram: ResidualBin[];
}

function buildResidualHistogram(residuals: number[], binCount = 9): ResidualBin[] {
  if (residuals.length === 0) return [];
  const minR = Math.min(...residuals);
  const maxR = Math.max(...residuals);
  const span = Math.max(2, maxR - minR);
  const step = span / binCount;
  const start = minR;

  const bins: ResidualBin[] = Array.from({ length: binCount }, (_, idx) => {
    const low = start + idx * step;
    const high = low + step;
    const center = (low + high) / 2;
    return {
      bin_label: `${low.toFixed(1)} to ${high.toFixed(1)}`,
      bin_center: Number(center.toFixed(2)),
      count: 0,
    };
  });

  for (const r of residuals) {
    const rawIdx = Math.floor((r - start) / step);
    const idx = Math.min(binCount - 1, Math.max(0, rawIdx));
    bins[idx].count++;
  }
  return bins;
}

export function trainAndSerializeModel(params: {
  rows: ObservationRow[];
  targetColumn: string;
  features: string[];
  version: string;
  modelName?: string;
  nEstimators?: number;
  maxDepth?: number;
  minSamplesLeaf?: number;
  trainRatio?: number;
  modelsDir: string;
  isDemoDataset: boolean;
}): TrainPipelineOutput {
  const split = prepareChronologicalSplit(
    params.rows,
    params.targetColumn,
    params.features,
    params.trainRatio ?? 0.8
  );

  // 1. Train Mean Baseline (predicts training mean only)
  const yTrainMean = split.yTrain.reduce((a, b) => a + b, 0) / split.yTrain.length;
  const meanPreds = split.yTest.map(() => yTrainMean);
  const meanStats = computeMetrics(split.yTest, meanPreds);

  // 2. Evaluate Persistence Baseline (y_hat_t = y_{t-1}) when lag1 is available
  let persistenceMae: number | null = null;
  let persistenceRmse: number | null = null;
  if (split.testMeta.every((m) => m.lag1 !== null)) {
    const persPreds = split.testMeta.map((m) => m.lag1 as number);
    const persStats = computeMetrics(split.yTest, persPreds);
    persistenceMae = persStats.mae;
    persistenceRmse = persStats.rmse;
  }

  // 3. Train Ridge Linear Regression Baseline
  const ridgeBaseline = trainRidgeRegression(split.XTrain, split.yTrain, 1.2);
  const linearPreds = split.XTest.map((row) => predictRidgeRegression(ridgeBaseline, row));
  const linearStats = computeMetrics(split.yTest, linearPreds);

  // 4. Train Primary Candidate: Random Forest Regressor
  const randomForest = trainRandomForest(split.XTrain, split.yTrain, {
    nEstimators: params.nEstimators ?? 35,
    maxDepth: params.maxDepth ?? 8,
    minSamplesLeaf: params.minSamplesLeaf ?? 4,
    seed: 202610,
  });

  const rfPreds = split.XTest.map((row) => predictRandomForest(randomForest, row));
  const rfStats = computeMetrics(split.yTest, rfPreds);

  // 5. Held-out Permutation Feature Importance
  const permImportances = computePermutationImportance(randomForest, split.XTest, split.yTest, rfStats.mae);

  const featureImportance: FeatureImportanceItem[] = split.features
    .map((feat, idx) => ({
      feature: feat,
      label: getFeatureLabel(feat),
      impurity_importance: randomForest.impurityImportance[idx] ?? 0,
      permutation_importance_mae: permImportances[idx] ?? 0,
    }))
    .sort((a, b) => b.permutation_importance_mae - a.permutation_importance_mae || b.impurity_importance - a.impurity_importance);

  const improvementVsLinear =
    linearStats.mae > 0 ? Number((((linearStats.mae - rfStats.mae) / linearStats.mae) * 100).toFixed(1)) : 0;
  const improvementVsMean =
    meanStats.mae > 0 ? Number((((meanStats.mae - rfStats.mae) / meanStats.mae) * 100).toFixed(1)) : 0;

  const metrics: ModelMetrics = {
    mae: rfStats.mae,
    rmse: rfStats.rmse,
    r2: rfStats.r2,
    linear_baseline_mae: linearStats.mae,
    linear_baseline_rmse: linearStats.rmse,
    persistence_baseline_mae: persistenceMae,
    persistence_baseline_rmse: persistenceRmse,
    mean_baseline_mae: meanStats.mae,
    mean_baseline_rmse: meanStats.rmse,
    improvement_vs_linear_pct: improvementVsLinear,
    improvement_vs_mean_pct: improvementVsMean,
  };

  const evaluationSeries: EvaluationPoint[] = split.yTest.map((actual, idx) => {
    const predRf = Number(rfPreds[idx].toFixed(2));
    const predLin = Number(linearPreds[idx].toFixed(2));
    return {
      date: split.testMeta[idx].date,
      location: split.testMeta[idx].location,
      actual: Number(actual.toFixed(2)),
      predicted_rf: predRf,
      predicted_linear: predLin,
      residual: Number((actual - predRf).toFixed(2)),
    };
  });

  const residuals = evaluationSeries.map((pt) => pt.residual);
  const residualHistogram = buildResidualHistogram(residuals, 9);

  const limitations: string[] = [
    split.taskType === 'Next-Step Lagged Forecast'
      ? 'Uses prior-day PM2.5 (t-1) plus supplied meteorological and co-pollutant conditions; estimates apply to the target day and do not constitute multi-week weather forecasting.'
      : 'Contemporaneous estimator: estimates PM2.5 for supplied environmental conditions rather than forecasting future meteorological states.',
    'Tree-based ensembles (Random Forest) do not extrapolate linearly beyond the minimum and maximum feature values observed during the training period.',
    `Evaluated on chronological held-out test window (${split.testPeriod.start} to ${split.testPeriod.end}) with MAE = ${rfStats.mae} ug/m3 and RMSE = ${rfStats.rmse} ug/m3.`,
  ];

  if (params.isDemoDataset) {
    limitations.unshift('Trained on bundled DEMO DATA — Illustrative sample dataset, not live regulatory monitoring observations.');
  }
  if (split.XTrain.length < 60) {
    limitations.push(`Limited training sample size (${split.XTrain.length} rows); widen historical coverage before operational interpretation.`);
  }

  const createdAt = new Date().toISOString();
  const artifact: SerializedModelArtifact = {
    version: params.version,
    modelName: params.modelName || 'EcoTwin Random Forest PM2.5 Regressor',
    algorithm: 'RandomForestRegressor (CART Ensemble)',
    taskType: split.taskType,
    target: split.target,
    unit: 'ug/m3',
    features: split.features,
    imputerMedians: split.imputerMedians,
    featureBounds: split.featureBounds,
    trainingPeriod: split.trainingPeriod,
    testPeriod: split.testPeriod,
    trainSize: split.XTrain.length,
    testSize: split.XTest.length,
    datasetSize: split.XTrain.length + split.XTest.length,
    metrics,
    featureImportance,
    limitations,
    randomForest,
    ridgeBaseline,
    createdAt,
  };

  fs.mkdirSync(params.modelsDir, { recursive: true });
  const safeVer = params.version.replace(/[^a-zA-Z0-9._-]/g, '_');
  const artifactPath = path.join(params.modelsDir, `ecotwin_rf_${safeVer}_${Date.now()}.json`);
  fs.writeFileSync(artifactPath, JSON.stringify(artifact), 'utf-8');

  return {
    artifact,
    artifactPath,
    evaluationSeries,
    residualHistogram,
  };
}

export function loadModelArtifact(artifactPath: string): SerializedModelArtifact {
  if (!fs.existsSync(artifactPath)) {
    throw new Error('Model artifact file is unavailable on disk. Please retrain or activate a valid model version.');
  }
  const raw = fs.readFileSync(artifactPath, 'utf-8');
  return JSON.parse(raw) as SerializedModelArtifact;
}

export function runArtifactInference(
  artifact: SerializedModelArtifact,
  suppliedInputs: Record<string, number | null | undefined>,
  standard: AirQualityStandard = 'CPCB_NAAQS'
): {
  predictedValue: number;
  ensembleIqr: { p25: number; p75: number; tree_std: number };
  linearComparisonValue: number;
  imputedFeatures: string[];
  extrapolatedFeatures: string[];
  warnings: string[];
  referenceCategory: ReturnType<typeof classifyPM25>;
  featureContributions: { feature: string; value: number; training_median: number; importance: number }[];
} {
  if (!artifact.features || artifact.features.length === 0) {
    throw new Error('Loaded model artifact has an invalid empty feature schema.');
  }

  // Reject completely empty or incompatible payloads
  const providedNumericCount = artifact.features.filter((f) => {
    const v = suppliedInputs[f];
    return typeof v === 'number' && Number.isFinite(v);
  }).length;

  if (providedNumericCount === 0) {
    throw new Error(
      `Incompatible prediction input: none of the model's required features (${artifact.features.join(', ')}) were supplied with numeric values.`
    );
  }

  const imputedFeatures: string[] = [];
  const extrapolatedFeatures: string[] = [];
  const warnings: string[] = [];
  const vector: number[] = [];

  for (const feat of artifact.features) {
    const rawVal = suppliedInputs[feat];
    const bounds = artifact.featureBounds[feat];
    if (rawVal === null || rawVal === undefined || !Number.isFinite(rawVal)) {
      imputedFeatures.push(feat);
      vector.push(artifact.imputerMedians[feat]);
    } else {
      if (['pm25_lag1', 'pm10', 'no2', 'so2', 'co', 'o3', 'wind_speed_ms', 'rainfall_mm'].includes(feat) && rawVal < 0) {
        throw new Error(`Invalid negative value (${rawVal}) supplied for physical measurement "${feat}".`);
      }
      if (feat === 'humidity_pct' && (rawVal < 0 || rawVal > 100)) {
        throw new Error(`Relative humidity (${rawVal}%) must be between 0% and 100%.`);
      }
      if (bounds && (rawVal < bounds.min || rawVal > bounds.max)) {
        extrapolatedFeatures.push(feat);
        warnings.push(
          `Input "${getFeatureLabel(feat)}" (${rawVal}) falls outside training range [${bounds.min}, ${bounds.max}]. Tree ensemble estimates clamp near boundary leaves.`
        );
      }
      vector.push(rawVal);
    }
  }

  if (imputedFeatures.length > 0) {
    warnings.push(
      `Imputed ${imputedFeatures.length} omitted feature(s) (${imputedFeatures.join(', ')}) using training-period median values.`
    );
  }

  const rfSpread = predictRandomForestWithSpread(artifact.randomForest, vector);
  const linearPred = Number(predictRidgeRegression(artifact.ridgeBaseline, vector).toFixed(2));
  const referenceCategory = classifyPM25(rfSpread.mean, standard);

  const importanceMap = new Map<string, number>();
  for (const item of artifact.featureImportance) {
    importanceMap.set(item.feature, item.impurity_importance);
  }

  const featureContributions = artifact.features.map((feat, idx) => ({
    feature: feat,
    value: Number(vector[idx].toFixed(2)),
    training_median: Number((artifact.imputerMedians[feat] ?? 0).toFixed(2)),
    importance: Number((importanceMap.get(feat) ?? 0).toFixed(4)),
  }));

  return {
    predictedValue: rfSpread.mean,
    ensembleIqr: {
      p25: rfSpread.p25,
      p75: rfSpread.p75,
      tree_std: rfSpread.treeStd,
    },
    linearComparisonValue: linearPred,
    imputedFeatures,
    extrapolatedFeatures,
    warnings,
    referenceCategory,
    featureContributions,
  };
}
