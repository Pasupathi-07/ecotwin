import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectCsvContent } from '../../server/ml/inspectData';
import { prepareChronologicalSplit } from '../../server/ml/preprocess';
import { loadModelArtifact, runArtifactInference, trainAndSerializeModel } from '../../server/ml/pipeline';
import { generateRuleBasedRecommendations } from '../../server/recommendations';

function buildSampleCsv(days = 50): string {
  const header = 'date,location,latitude,longitude,pm25,pm10,no2,so2,co,o3,temperature_c,humidity_pct,wind_speed_ms,rainfall_mm';
  const lines = [header];
  for (let i = 0; i < days; i++) {
    const dt = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    const no2 = 22 + (i % 10) * 3.1;
    const wind = 1.6 + (i % 5) * 0.7;
    const pm25 = Number((20 + no2 * 0.8 - wind * 3.4).toFixed(1));
    const pm10 = Number((pm25 * 1.75 + 8).toFixed(1));
    lines.push(`${dt},Chennai - Alandur,13.0025,80.2060,${pm25},${pm10},${no2.toFixed(1)},9.4,1.05,36.2,28.5,71.0,${wind.toFixed(2)},0.0`);
  }
  // Add 1 duplicate row and 1 invalid negative concentration to verify cleaning
  lines.push('2026-01-01,Chennai - Alandur,13.0025,80.2060,99.9,140,40,10,1.2,35,28,70,2.0,0');
  lines.push('2026-03-01,Chennai - Alandur,13.0025,80.2060,-12.5,80,30,10,1.1,35,29,72,2.5,0');
  return lines.join('\n');
}

describe('EcoTwin AI — Data Inspection, Chronological ML, Inference & Rules', () => {
  it('inspects CSV, removes duplicate station-date records, and nullifies negative physical readings', () => {
    const csv = buildSampleCsv(45);
    const res = inspectCsvContent(csv, 'pm25');

    expect(res.duplicateCount).toBe(1);
    expect(res.invalidNumericTotal).toBeGreaterThanOrEqual(1);
    expect(res.rawRowCount).toBe(46); // 45 valid + 1 row with nullified negative pm25
    expect(res.locations).toContain('Chennai - Alandur');
    expect(res.validationStatus).not.toBe('Invalid');
  });

  it('enforces chronological train/test split without future leakage', () => {
    const csv = buildSampleCsv(50);
    const inspected = inspectCsvContent(csv, 'pm25');
    const split = prepareChronologicalSplit(
      inspected.rows,
      'pm25',
      ['pm25_lag1', 'no2', 'so2', 'temperature_c', 'humidity_pct', 'wind_speed_ms'],
      0.8
    );

    expect(split.trainingPeriod.end < split.testPeriod.start).toBe(true);
    expect(split.XTrain.length).toBeGreaterThan(25);
    expect(split.XTest.length).toBeGreaterThan(5);
  });

  it('trains Baseline + Random Forest, serializes artifact, runs inference, and flags extrapolation', () => {
    const tmpModelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecotwin-test-'));
    const inspected = inspectCsvContent(buildSampleCsv(60), 'pm25');

    const trained = trainAndSerializeModel({
      rows: inspected.rows,
      targetColumn: 'pm25',
      features: ['pm25_lag1', 'no2', 'so2', 'co', 'o3', 'temperature_c', 'humidity_pct', 'wind_speed_ms', 'rainfall_mm'],
      version: 'v1.0.0-unit',
      nEstimators: 25,
      maxDepth: 7,
      minSamplesLeaf: 3,
      trainRatio: 0.8,
      modelsDir: tmpModelsDir,
      isDemoDataset: true,
    });

    expect(trained.artifact.metrics.mae).toBeGreaterThan(0);
    expect(trained.artifact.metrics.rmse).toBeGreaterThanOrEqual(trained.artifact.metrics.mae);
    expect(fs.existsSync(trained.artifactPath)).toBe(true);

    const loaded = loadModelArtifact(trained.artifactPath);
    const inRangeResult = runArtifactInference(loaded, {
      pm25_lag1: 36,
      no2: 31,
      so2: 9.4,
      co: 1.05,
      o3: 36.2,
      temperature_c: 28.5,
      humidity_pct: 71,
      wind_speed_ms: 2.3,
      rainfall_mm: 0,
    });

    expect(inRangeResult.predictedValue).toBeGreaterThan(10);
    expect(inRangeResult.extrapolatedFeatures).toHaveLength(0);

    // Out-of-bounds NO2 triggers explicit extrapolation warning
    const extrapolatedResult = runArtifactInference(loaded, {
      pm25_lag1: 36,
      no2: 390,
      so2: 9.4,
      co: 1.05,
      o3: 36.2,
      temperature_c: 28.5,
      humidity_pct: 71,
      wind_speed_ms: 2.3,
      rainfall_mm: 0,
    });
    expect(extrapolatedResult.extrapolatedFeatures).toContain('no2');
    expect(extrapolatedResult.warnings.length).toBeGreaterThan(0);

    // Reject negative physical concentrations
    expect(() =>
      runArtifactInference(loaded, {
        pm25_lag1: -10,
        no2: 25,
      })
    ).toThrow(/negative/i);

    fs.rmSync(tmpModelsDir, { recursive: true, force: true });
  });

  it('generates deterministic, rule-linked recommendations for elevated PM2.5', () => {
    const inspected = inspectCsvContent(buildSampleCsv(40), 'pm25');
    // Elevate PM2.5 above CPCB 60 ug/m3 threshold
    const highPollutionRows = inspected.rows.map((r) => ({ ...r, pm25: 88, pm10: 130 }));

    const recs = generateRuleBasedRecommendations({
      dataset: {
        id: 1,
        name: 'Test Archive',
        source: 'Unit Test',
        license_info: 'CC0',
        is_demo: false,
        uploaded_at: new Date().toISOString(),
        row_count: highPollutionRows.length,
        column_count: 14,
        duplicate_count: 0,
        invalid_numeric_total: 0,
        column_schema: inspected.columnSchema,
        date_range: inspected.dateRange,
        location_count: 1,
        locations: ['Chennai - Alandur'],
        missing_pct: 0,
        target_column: 'pm25',
        feature_columns: inspected.featureColumns,
        validation_status: 'Valid',
        validation_notes: [],
      },
      rows: highPollutionRows,
      location: 'Chennai - Alandur',
      activeModel: null,
      standard: 'CPCB_NAAQS',
    });

    expect(recs.some((r) => r.id === 'rec-pm25-exceedance')).toBe(true);
    expect(recs.some((r) => r.id === 'rec-combustion-signature')).toBe(true);
  });
});
