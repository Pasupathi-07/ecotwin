import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  DatasetRecord,
  ModelVersionRecord,
  ObservationRow,
  PredictionRecord,
  ReportRecord,
  ScenarioComparisonResult,
} from '../src/types/ecotwin.ts';
import { inspectCsvContent } from './ml/inspectData.ts';
import { trainAndSerializeModel } from './ml/pipeline.ts';
import { ensureDemoDatasetsOnDisk } from './stations.ts';

const DATA_ROOT = path.resolve(process.cwd(), process.env.ECOTWIN_DATA_DIR || './data');
export const DATASETS_DIR = path.join(DATA_ROOT, 'datasets');
export const UPLOADS_DIR = path.join(DATA_ROOT, 'uploads');
export const MODELS_DIR = path.join(DATA_ROOT, 'saved_models');
export const REPORTS_DIR = path.join(DATA_ROOT, 'reports');
const DB_PATH = path.resolve(process.cwd(), process.env.ECOTWIN_DB_PATH || path.join(DATA_ROOT, 'ecotwin.sqlite'));

fs.mkdirSync(DATASETS_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(MODELS_DIR, { recursive: true });
fs.mkdirSync(REPORTS_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// In-memory read cache for parsed CSV rows keyed by dataset_id + file mtime
const datasetRowsCache = new Map<number, { mtimeMs: number; rows: ObservationRow[] }>();

export function initializeDatabaseAndSeed(): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS datasets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      source TEXT NOT NULL,
      license_info TEXT NOT NULL DEFAULT 'Academic / Open Demonstration',
      is_demo INTEGER NOT NULL DEFAULT 0,
      file_path TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      column_count INTEGER NOT NULL,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      invalid_numeric_total INTEGER NOT NULL DEFAULT 0,
      column_schema TEXT NOT NULL,
      date_range TEXT NOT NULL,
      location_count INTEGER NOT NULL DEFAULT 1,
      locations TEXT NOT NULL DEFAULT '[]',
      missing_pct REAL NOT NULL DEFAULT 0,
      target_column TEXT NOT NULL DEFAULT 'pm25',
      feature_columns TEXT NOT NULL DEFAULT '[]',
      validation_status TEXT NOT NULL,
      validation_notes TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS model_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id INTEGER NOT NULL,
      model_name TEXT NOT NULL,
      version TEXT NOT NULL,
      algorithm TEXT NOT NULL,
      task_type TEXT NOT NULL,
      target TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'ug/m3',
      features TEXT NOT NULL,
      hyperparameters TEXT NOT NULL,
      training_period TEXT NOT NULL,
      test_period TEXT NOT NULL,
      dataset_size INTEGER NOT NULL,
      train_size INTEGER NOT NULL,
      test_size INTEGER NOT NULL,
      metrics TEXT NOT NULL,
      feature_importance TEXT NOT NULL,
      feature_bounds TEXT NOT NULL,
      evaluation_series TEXT NOT NULL,
      residual_histogram TEXT NOT NULL,
      limitations TEXT NOT NULL,
      artifact_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_version_id INTEGER NOT NULL,
      location TEXT NOT NULL,
      observation_date TEXT NOT NULL,
      input_payload TEXT NOT NULL,
      imputed_features TEXT NOT NULL DEFAULT '[]',
      extrapolated_features TEXT NOT NULL DEFAULT '[]',
      predicted_value REAL NOT NULL,
      ensemble_iqr TEXT NOT NULL,
      linear_comparison_value REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT 'ug/m3',
      reference_category TEXT NOT NULL,
      warnings TEXT NOT NULL DEFAULT '[]',
      limitations TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY (model_version_id) REFERENCES model_versions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scenarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      baseline_inputs TEXT NOT NULL,
      modified_inputs TEXT NOT NULL,
      baseline_output REAL NOT NULL,
      modified_output REAL NOT NULL,
      raw_model_modified_output REAL NOT NULL,
      emissions_adjustment_pct REAL NOT NULL DEFAULT 0,
      abs_diff REAL NOT NULL,
      pct_diff REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT 'ug/m3',
      baseline_category TEXT NOT NULL,
      modified_category TEXT NOT NULL,
      parameter_deltas TEXT NOT NULL,
      model_version_id INTEGER NOT NULL,
      assumptions TEXT NOT NULL,
      warnings TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY (model_version_id) REFERENCES model_versions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_name TEXT NOT NULL,
      report_type TEXT NOT NULL,
      location TEXT NOT NULL,
      date_range TEXT NOT NULL,
      summary_payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      file_path TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_models_active ON model_versions(is_active);
    CREATE INDEX IF NOT EXISTS idx_predictions_loc_date ON predictions(location, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scenarios_created ON scenarios(created_at DESC);
  `);

  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM datasets').get() as { cnt: number };
  if (countRow.cnt === 0) {
    const { primaryDemoCsvPath, compactValidationCsvPath } = ensureDemoDatasetsOnDisk(DATASETS_DIR);

    // Seed Primary Demo Dataset
    const primaryCsv = fs.readFileSync(primaryDemoCsvPath, 'utf-8');
    const primaryInspected = inspectCsvContent(primaryCsv, 'pm25');
    const nowIso = new Date().toISOString();

    const insertDatasetStmt = db.prepare(`
      INSERT INTO datasets (
        name, source, license_info, is_demo, file_path, uploaded_at,
        row_count, column_count, duplicate_count, invalid_numeric_total,
        column_schema, date_range, location_count, locations, missing_pct,
        target_column, feature_columns, validation_status, validation_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const primaryRes = insertDatasetStmt.run(
      'Multi-Station Regional Air Quality Archive (DEMO DATA)',
      'DEMO DATA — Illustrative or sample data, not live environmental observations',
      'CC0-1.0 Academic Software Demonstration Archive',
      1,
      primaryDemoCsvPath,
      nowIso,
      primaryInspected.rawRowCount,
      primaryInspected.columnCount,
      primaryInspected.duplicateCount,
      primaryInspected.invalidNumericTotal,
      JSON.stringify(primaryInspected.columnSchema),
      JSON.stringify(primaryInspected.dateRange),
      primaryInspected.locations.length,
      JSON.stringify(primaryInspected.locations),
      primaryInspected.missingPct,
      primaryInspected.targetColumn,
      JSON.stringify(primaryInspected.featureColumns),
      primaryInspected.validationStatus,
      JSON.stringify([
        'DEMO DATA — Illustrative or sample data, not live environmental observations.',
        ...primaryInspected.validationNotes,
      ])
    );

    const primaryDatasetId = Number(primaryRes.lastInsertRowid);

    // Seed Secondary Compact Test Dataset
    const compactCsv = fs.readFileSync(compactValidationCsvPath, 'utf-8');
    const compactInspected = inspectCsvContent(compactCsv, 'pm25');
    insertDatasetStmt.run(
      'Two-Station Compact Validation Subset (DEMO DATA)',
      'DEMO DATA — Illustrative or sample data, not live environmental observations',
      'CC0-1.0 Software Pipeline Verification Subset',
      1,
      compactValidationCsvPath,
      nowIso,
      compactInspected.rawRowCount,
      compactInspected.columnCount,
      compactInspected.duplicateCount,
      compactInspected.invalidNumericTotal,
      JSON.stringify(compactInspected.columnSchema),
      JSON.stringify(compactInspected.dateRange),
      compactInspected.locations.length,
      JSON.stringify(compactInspected.locations),
      compactInspected.missingPct,
      compactInspected.targetColumn,
      JSON.stringify(compactInspected.featureColumns),
      compactInspected.validationStatus,
      JSON.stringify([
        'DEMO DATA — Illustrative or sample data, not live environmental observations.',
        ...compactInspected.validationNotes,
      ])
    );

    // Train & persist real initial Random Forest + Linear Baseline model on primary dataset
    const defaultFeatures = [
      'pm25_lag1',
      'no2',
      'so2',
      'co',
      'o3',
      'temperature_c',
      'humidity_pct',
      'wind_speed_ms',
      'rainfall_mm',
    ];

    const trained = trainAndSerializeModel({
      rows: primaryInspected.rows,
      targetColumn: 'pm25',
      features: defaultFeatures,
      version: 'v1.0.0',
      modelName: 'EcoTwin Random Forest PM2.5 Regressor',
      nEstimators: 35,
      maxDepth: 8,
      minSamplesLeaf: 4,
      trainRatio: 0.8,
      modelsDir: MODELS_DIR,
      isDemoDataset: true,
    });

    const insertModelStmt = db.prepare(`
      INSERT INTO model_versions (
        dataset_id, model_name, version, algorithm, task_type, target, unit,
        features, hyperparameters, training_period, test_period,
        dataset_size, train_size, test_size, metrics, feature_importance,
        feature_bounds, evaluation_series, residual_histogram, limitations,
        artifact_path, created_at, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const modelRes = insertModelStmt.run(
      primaryDatasetId,
      trained.artifact.modelName,
      trained.artifact.version,
      trained.artifact.algorithm,
      trained.artifact.taskType,
      trained.artifact.target,
      trained.artifact.unit,
      JSON.stringify(trained.artifact.features),
      JSON.stringify({
        n_estimators: 35,
        max_depth: 8,
        min_samples_leaf: 4,
        train_ratio: 0.8,
      }),
      JSON.stringify(trained.artifact.trainingPeriod),
      JSON.stringify(trained.artifact.testPeriod),
      trained.artifact.datasetSize,
      trained.artifact.trainSize,
      trained.artifact.testSize,
      JSON.stringify(trained.artifact.metrics),
      JSON.stringify(trained.artifact.featureImportance),
      JSON.stringify(trained.artifact.featureBounds),
      JSON.stringify(trained.evaluationSeries),
      JSON.stringify(trained.residualHistogram),
      JSON.stringify(trained.artifact.limitations),
      trained.artifactPath,
      trained.artifact.createdAt,
      1
    );

    const activeModelId = Number(modelRes.lastInsertRowid);

    // Seed 1 example scenario comparison using actual trained model inference so Scenario History isn't blank
    const baselineIn = {
      pm25_lag1: 42.0,
      no2: 34.0,
      so2: 11.2,
      co: 1.18,
      o3: 39.0,
      temperature_c: 27.5,
      humidity_pct: 72.0,
      wind_speed_ms: 2.1,
      rainfall_mm: 0.0,
    };
    const modifiedIn = {
      ...baselineIn,
      no2: 24.0,
      so2: 8.5,
      wind_speed_ms: 4.2,
    };

    // Compute exact outputs from the trained artifact
    const baseVec = defaultFeatures.map((f) => baselineIn[f as keyof typeof baselineIn]);
    const modVec = defaultFeatures.map((f) => modifiedIn[f as keyof typeof modifiedIn]);
    const rfTrees = trained.artifact.randomForest.trees;
    const evalTree = (node: (typeof rfTrees)[number], vec: number[]): number => {
      let c = node;
      while (!c.isLeaf && c.featureIdx !== undefined && c.threshold !== undefined) {
        c = vec[c.featureIdx] <= c.threshold ? c.left! : c.right!;
      }
      return c.value;
    };
    const bOut = Number((rfTrees.reduce((acc, t) => acc + evalTree(t, baseVec), 0) / rfTrees.length).toFixed(2));
    const mOut = Number((rfTrees.reduce((acc, t) => acc + evalTree(t, modVec), 0) / rfTrees.length).toFixed(2));
    const absDiff = Number((mOut - bOut).toFixed(2));
    const pctDiff = bOut > 0 ? Number((((mOut - bOut) / bOut) * 100).toFixed(1)) : 0;

    db.prepare(`
      INSERT INTO scenarios (
        name, location, baseline_inputs, modified_inputs,
        baseline_output, modified_output, raw_model_modified_output,
        emissions_adjustment_pct, abs_diff, pct_diff, unit,
        baseline_category, modified_category, parameter_deltas,
        model_version_id, assumptions, warnings, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'Corridor NO2 Reduction + Coastal Breeze Dispersion',
      'Chennai - Alandur',
      JSON.stringify(baselineIn),
      JSON.stringify(modifiedIn),
      bOut,
      mOut,
      mOut,
      0,
      absDiff,
      pctDiff,
      'ug/m3',
      bOut <= 30 ? 'Good (0 - 30 ug/m3)' : bOut <= 60 ? 'Satisfactory (31 - 60 ug/m3)' : 'Moderately Polluted (61 - 90 ug/m3)',
      mOut <= 30 ? 'Good (0 - 30 ug/m3)' : mOut <= 60 ? 'Satisfactory (31 - 60 ug/m3)' : 'Moderately Polluted (61 - 90 ug/m3)',
      JSON.stringify([
        { feature: 'no2', label: 'Nitrogen Dioxide (NO2)', unit: 'ug/m3', baseline: 34.0, modified: 24.0, delta: -10.0, delta_pct: -29.4, out_of_bounds: false, training_min: trained.artifact.featureBounds.no2.min, training_max: trained.artifact.featureBounds.no2.max },
        { feature: 'so2', label: 'Sulfur Dioxide (SO2)', unit: 'ug/m3', baseline: 11.2, modified: 8.5, delta: -2.7, delta_pct: -24.1, out_of_bounds: false, training_min: trained.artifact.featureBounds.so2.min, training_max: trained.artifact.featureBounds.so2.max },
        { feature: 'wind_speed_ms', label: 'Surface Wind Speed', unit: 'm/s', baseline: 2.1, modified: 4.2, delta: 2.1, delta_pct: 100.0, out_of_bounds: false, training_min: trained.artifact.featureBounds.wind_speed_ms.min, training_max: trained.artifact.featureBounds.wind_speed_ms.max },
      ]),
      activeModelId,
      JSON.stringify([
        'Scenario estimate computed directly via Random Forest v1.0.0 feature perturbation.',
        'Assumes prior-day PM2.5 (42.0 ug/m3), temperature (27.5 deg C), and humidity (72%) remain fixed while NO2, SO2, and surface wind speed vary.',
        'Represents conditional statistical association in historical DEMO DATA rather than a guaranteed causal policy effect.',
      ]),
      JSON.stringify([
        'Evaluated on model trained with DEMO DATA — Illustrative sample dataset.',
      ]),
      nowIso
    );
  }
}

export function mapDatasetRow(row: Record<string, unknown>): DatasetRecord {
  return {
    id: Number(row.id),
    name: String(row.name),
    source: String(row.source),
    license_info: String(row.license_info),
    is_demo: Boolean(row.is_demo),
    uploaded_at: String(row.uploaded_at),
    row_count: Number(row.row_count),
    column_count: Number(row.column_count),
    duplicate_count: Number(row.duplicate_count),
    invalid_numeric_total: Number(row.invalid_numeric_total),
    column_schema: JSON.parse(String(row.column_schema)),
    date_range: JSON.parse(String(row.date_range)),
    location_count: Number(row.location_count),
    locations: JSON.parse(String(row.locations)),
    missing_pct: Number(row.missing_pct),
    target_column: String(row.target_column),
    feature_columns: JSON.parse(String(row.feature_columns)),
    validation_status: row.validation_status as DatasetRecord['validation_status'],
    validation_notes: JSON.parse(String(row.validation_notes)),
  };
}

export function getDatasetFilePath(datasetId: number): string | null {
  const row = db.prepare('SELECT file_path FROM datasets WHERE id = ?').get(datasetId) as { file_path: string } | undefined;
  return row ? row.file_path : null;
}

export function loadDatasetObservations(datasetId: number): ObservationRow[] {
  const row = db.prepare('SELECT id, file_path, target_column FROM datasets WHERE id = ?').get(datasetId) as
    | { id: number; file_path: string; target_column: string }
    | undefined;
  if (!row || !fs.existsSync(row.file_path)) {
    return [];
  }
  const stat = fs.statSync(row.file_path);
  const cached = datasetRowsCache.get(datasetId);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.rows;
  }

  const csvText = fs.readFileSync(row.file_path, 'utf-8');
  const inspected = inspectCsvContent(csvText, row.target_column);
  datasetRowsCache.set(datasetId, { mtimeMs: stat.mtimeMs, rows: inspected.rows });
  return inspected.rows;
}

export function mapModelVersionRow(row: Record<string, unknown>): ModelVersionRecord & { artifact_path: string } {
  return {
    id: Number(row.id),
    dataset_id: Number(row.dataset_id),
    dataset_name: row.dataset_name ? String(row.dataset_name) : undefined,
    is_demo_dataset: row.is_demo !== undefined ? Boolean(row.is_demo) : undefined,
    model_name: String(row.model_name),
    version: String(row.version),
    algorithm: String(row.algorithm),
    task_type: row.task_type as ModelVersionRecord['task_type'],
    target: String(row.target),
    unit: String(row.unit),
    features: JSON.parse(String(row.features)),
    hyperparameters: JSON.parse(String(row.hyperparameters)),
    training_period: JSON.parse(String(row.training_period)),
    test_period: JSON.parse(String(row.test_period)),
    dataset_size: Number(row.dataset_size),
    train_size: Number(row.train_size),
    test_size: Number(row.test_size),
    metrics: JSON.parse(String(row.metrics)),
    feature_importance: JSON.parse(String(row.feature_importance)),
    feature_bounds: JSON.parse(String(row.feature_bounds)),
    evaluation_series: JSON.parse(String(row.evaluation_series)),
    residual_histogram: JSON.parse(String(row.residual_histogram)),
    limitations: JSON.parse(String(row.limitations)),
    artifact_path: String(row.artifact_path),
    created_at: String(row.created_at),
    is_active: Boolean(row.is_active),
  };
}

export function getActiveModelRecord(): (ModelVersionRecord & { artifact_path: string }) | null {
  const row = db
    .prepare(
      `SELECT m.*, d.name as dataset_name, d.is_demo as is_demo
       FROM model_versions m
       LEFT JOIN datasets d ON m.dataset_id = d.id
       WHERE m.is_active = 1
       ORDER BY m.id DESC LIMIT 1`
    )
    .get() as Record<string, unknown> | undefined;
  return row ? mapModelVersionRow(row) : null;
}

export function getModelRecordById(modelId: number): (ModelVersionRecord & { artifact_path: string }) | null {
  const row = db
    .prepare(
      `SELECT m.*, d.name as dataset_name, d.is_demo as is_demo
       FROM model_versions m
       LEFT JOIN datasets d ON m.dataset_id = d.id
       WHERE m.id = ?`
    )
    .get(modelId) as Record<string, unknown> | undefined;
  return row ? mapModelVersionRow(row) : null;
}

export function mapPredictionRow(row: Record<string, unknown>): PredictionRecord {
  const metricsJson = row.model_metrics ? JSON.parse(String(row.model_metrics)) : { mae: 0, rmse: 0 };
  const featImpJson = row.model_feature_importance ? JSON.parse(String(row.model_feature_importance)) : [];
  const boundsJson = row.model_feature_bounds ? JSON.parse(String(row.model_feature_bounds)) : {};
  const payload = JSON.parse(String(row.input_payload)) as Record<string, number | null>;

  const impLookup = new Map<string, number>();
  for (const item of featImpJson) {
    impLookup.set(item.feature, item.impurity_importance ?? 0);
  }

  const contributions = Object.entries(payload).map(([feat, val]) => ({
    feature: feat,
    value: typeof val === 'number' ? val : boundsJson[feat]?.median ?? 0,
    training_median: boundsJson[feat]?.median ?? 0,
    importance: impLookup.get(feat) ?? 0,
  }));

  return {
    id: Number(row.id),
    model_version_id: Number(row.model_version_id),
    model_version: String(row.model_version || 'v1.0.0'),
    model_name: String(row.model_name || 'Random Forest Regressor'),
    task_type: String(row.task_type || 'Next-Step Lagged Forecast'),
    is_demo_model: Boolean(row.is_demo_model),
    location: String(row.location),
    observation_date: String(row.observation_date),
    input_payload: payload,
    imputed_features: JSON.parse(String(row.imputed_features || '[]')),
    extrapolated_features: JSON.parse(String(row.extrapolated_features || '[]')),
    predicted_value: Number(row.predicted_value),
    ensemble_iqr: JSON.parse(String(row.ensemble_iqr)),
    linear_comparison_value: Number(row.linear_comparison_value),
    unit: String(row.unit),
    reference_category: JSON.parse(String(row.reference_category)),
    model_metrics: { mae: Number(metricsJson.mae ?? 0), rmse: Number(metricsJson.rmse ?? 0) },
    feature_contributions: contributions,
    warnings: JSON.parse(String(row.warnings || '[]')),
    limitations: JSON.parse(String(row.limitations || '[]')),
    created_at: String(row.created_at),
  };
}

export function mapScenarioRow(row: Record<string, unknown>): ScenarioComparisonResult {
  return {
    id: Number(row.id),
    name: String(row.name),
    location: String(row.location),
    model_version_id: Number(row.model_version_id),
    model_version: String(row.model_version || 'v1.0.0'),
    is_demo_model: Boolean(row.is_demo_model),
    baseline_inputs: JSON.parse(String(row.baseline_inputs)),
    modified_inputs: JSON.parse(String(row.modified_inputs)),
    baseline_output: Number(row.baseline_output),
    modified_output: Number(row.modified_output),
    raw_model_modified_output: Number(row.raw_model_modified_output),
    emissions_adjustment_pct: Number(row.emissions_adjustment_pct),
    abs_diff: Number(row.abs_diff),
    pct_diff: Number(row.pct_diff),
    unit: String(row.unit),
    baseline_category: String(row.baseline_category),
    modified_category: String(row.modified_category),
    parameter_deltas: JSON.parse(String(row.parameter_deltas)),
    assumptions: JSON.parse(String(row.assumptions)),
    warnings: JSON.parse(String(row.warnings || '[]')),
    created_at: String(row.created_at),
  };
}

export function mapReportRow(row: Record<string, unknown>): ReportRecord {
  return {
    id: Number(row.id),
    report_name: String(row.report_name),
    report_type: row.report_type as ReportRecord['report_type'],
    location: String(row.location),
    date_range: JSON.parse(String(row.date_range)),
    summary_payload: JSON.parse(String(row.summary_payload || '{}')),
    created_at: String(row.created_at),
  };
}
