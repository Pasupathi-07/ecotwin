import type { FeatureBounds, ObservationRow } from '../../src/types/ecotwin.ts';

export interface PreprocessedDataset {
  features: string[];
  target: string;
  taskType: 'Contemporaneous Estimate' | 'Next-Step Lagged Forecast';
  XTrain: number[][];
  yTrain: number[];
  trainMeta: { date: string; location: string; lag1: number | null }[];
  XTest: number[][];
  yTest: number[];
  testMeta: { date: string; location: string; lag1: number | null }[];
  imputerMedians: Record<string, number>;
  scalerMeans: Record<string, number>;
  scalerStds: Record<string, number>;
  featureBounds: Record<string, FeatureBounds>;
  trainingPeriod: { start: string; end: string };
  testPeriod: { start: string; end: string };
}

export const FEATURE_LABELS: Record<string, { label: string; unit: string }> = {
  pm25_lag1: { label: 'Prior-Day PM2.5 (t-1)', unit: 'ug/m3' },
  pm10: { label: 'PM10 Coarse Particulate', unit: 'ug/m3' },
  no2: { label: 'Nitrogen Dioxide (NO2)', unit: 'ug/m3' },
  so2: { label: 'Sulfur Dioxide (SO2)', unit: 'ug/m3' },
  co: { label: 'Carbon Monoxide (CO)', unit: 'mg/m3' },
  o3: { label: 'Ground-Level Ozone (O3)', unit: 'ug/m3' },
  temperature_c: { label: 'Ambient Temperature', unit: 'deg C' },
  humidity_pct: { label: 'Relative Humidity', unit: '%' },
  wind_speed_ms: { label: 'Surface Wind Speed', unit: 'm/s' },
  rainfall_mm: { label: 'Daily Precipitation', unit: 'mm' },
  green_index_ndvi: { label: 'Vegetation Index (NDVI)', unit: 'index' },
};

export function getFeatureLabel(feature: string): string {
  return FEATURE_LABELS[feature]?.label || feature.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getFeatureUnit(feature: string): string {
  return FEATURE_LABELS[feature]?.unit || '';
}

function computeQuantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

/**
 * Enriches chronologically ordered station records with strictly past lag-1 target values
 * without leaking current or future observations.
 */
export function buildChronologicalRecords(
  rows: ObservationRow[],
  targetCol = 'pm25'
): (ObservationRow & { pm25_lag1: number | null })[] {
  const byLocation = new Map<string, ObservationRow[]>();
  for (const r of rows) {
    const list = byLocation.get(r.location) || [];
    list.push(r);
    byLocation.set(r.location, list);
  }

  const enriched: (ObservationRow & { pm25_lag1: number | null })[] = [];

  for (const [, locRows] of byLocation.entries()) {
    const sorted = [...locRows].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < sorted.length; i++) {
      const prev = i > 0 ? sorted[i - 1][targetCol] : null;
      const lag1 = typeof prev === 'number' && Number.isFinite(prev) ? prev : null;
      enriched.push({
        ...sorted[i],
        pm25_lag1: lag1,
      });
    }
  }

  // Sort globally by date ascending so chronological split never trains on future dates
  enriched.sort((a, b) => a.date.localeCompare(b.date) || a.location.localeCompare(b.location));
  return enriched;
}

export function prepareChronologicalSplit(
  rows: ObservationRow[],
  targetCol: string,
  requestedFeatures: string[],
  trainRatio = 0.8
): PreprocessedDataset {
  const clampedRatio = Math.min(0.9, Math.max(0.6, trainRatio));
  const enriched = buildChronologicalRecords(rows, targetCol);

  // Filter rows that have a valid target observation (we never impute the target variable)
  const validTargetRows = enriched.filter((r) => {
    const t = r[targetCol];
    if (typeof t !== 'number' || !Number.isFinite(t)) return false;
    // If pm25_lag1 is requested, drop the initial warm-up day per station where lag1 doesn't exist yet
    if (requestedFeatures.includes('pm25_lag1') && r.pm25_lag1 === null) return false;
    return true;
  });

  if (validTargetRows.length < 15) {
    throw new Error(`Insufficient valid target records (${validTargetRows.length}) after chronological filtering. At least 15 records are required.`);
  }

  // Split by unique dates chronologically so all stations on date T belong exclusively to train or test
  const uniqueDates = Array.from(new Set(validTargetRows.map((r) => r.date))).sort();
  let trainRows: typeof validTargetRows = [];
  let testRows: typeof validTargetRows = [];

  if (uniqueDates.length >= 10) {
    const splitDateIdx = Math.max(1, Math.min(uniqueDates.length - 2, Math.floor(uniqueDates.length * clampedRatio)));
    const cutoffDate = uniqueDates[splitDateIdx];
    trainRows = validTargetRows.filter((r) => r.date < cutoffDate);
    testRows = validTargetRows.filter((r) => r.date >= cutoffDate);
  } else {
    const splitIdx = Math.floor(validTargetRows.length * clampedRatio);
    trainRows = validTargetRows.slice(0, splitIdx);
    testRows = validTargetRows.slice(splitIdx);
  }

  if (trainRows.length < 10 || testRows.length < 3) {
    throw new Error('Chronological split produced insufficient train or test observations.');
  }

  // Verify which requested features actually exist in training rows
  const usableFeatures = requestedFeatures.filter((feat) =>
    trainRows.some((r) => typeof r[feat] === 'number' && Number.isFinite(r[feat] as number))
  );

  if (usableFeatures.length === 0) {
    throw new Error('None of the selected feature columns contain valid numeric values in the training period.');
  }

  // Fit median imputer, scaler, and training bounds STRICTLY on XTrain (zero test leakage)
  const imputerMedians: Record<string, number> = {};
  const scalerMeans: Record<string, number> = {};
  const scalerStds: Record<string, number> = {};
  const featureBounds: Record<string, FeatureBounds> = {};

  for (const feat of usableFeatures) {
    const vals = trainRows
      .map((r) => r[feat])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => a - b);

    const med = computeQuantile(vals, 0.5);
    const mean = vals.reduce((acc, v) => acc + v, 0) / vals.length;
    const variance = vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / vals.length;
    const std = Math.sqrt(variance) || 1;

    imputerMedians[feat] = Number(med.toFixed(4));
    scalerMeans[feat] = Number(mean.toFixed(4));
    scalerStds[feat] = Number(std.toFixed(4));
    featureBounds[feat] = {
      min: Number(vals[0].toFixed(3)),
      p05: Number(computeQuantile(vals, 0.05).toFixed(3)),
      median: Number(med.toFixed(3)),
      mean: Number(mean.toFixed(3)),
      std: Number(std.toFixed(3)),
      p95: Number(computeQuantile(vals, 0.95).toFixed(3)),
      max: Number(vals[vals.length - 1].toFixed(3)),
    };
  }

  const encodeRow = (r: ObservationRow & { pm25_lag1: number | null }): number[] =>
    usableFeatures.map((feat) => {
      const v = r[feat];
      return typeof v === 'number' && Number.isFinite(v) ? v : imputerMedians[feat];
    });

  const XTrain = trainRows.map(encodeRow);
  const yTrain = trainRows.map((r) => Number(r[targetCol]));
  const trainMeta = trainRows.map((r) => ({ date: r.date, location: r.location, lag1: r.pm25_lag1 }));

  const XTest = testRows.map(encodeRow);
  const yTest = testRows.map((r) => Number(r[targetCol]));
  const testMeta = testRows.map((r) => ({ date: r.date, location: r.location, lag1: r.pm25_lag1 }));

  const taskType = usableFeatures.includes('pm25_lag1')
    ? 'Next-Step Lagged Forecast'
    : 'Contemporaneous Estimate';

  return {
    features: usableFeatures,
    target: targetCol,
    taskType,
    XTrain,
    yTrain,
    trainMeta,
    XTest,
    yTest,
    testMeta,
    imputerMedians,
    scalerMeans,
    scalerStds,
    featureBounds,
    trainingPeriod: {
      start: trainRows[0].date,
      end: trainRows[trainRows.length - 1].date,
    },
    testPeriod: {
      start: testRows[0].date,
      end: testRows[testRows.length - 1].date,
    },
  };
}
