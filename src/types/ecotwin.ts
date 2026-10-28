export type EvidenceOrigin =
  | 'Observed'
  | 'Historical'
  | 'Model prediction'
  | 'Demonstration data'
  | 'Hypothetical scenario'
  | 'Unavailable';

export type AirQualityStandard = 'WHO_2021' | 'CPCB_NAAQS';

export interface StationMetadata {
  location: string;
  station_code: string;
  city: string;
  region: string;
  latitude: number;
  longitude: number;
  zone_type: 'Urban Traffic' | 'Industrial' | 'Residential' | 'Peri-Urban Background';
  elevation_m: number;
}

export interface ColumnSchemaItem {
  name: string;
  dtype: 'numeric' | 'datetime' | 'categorical' | 'boolean';
  missing_count: number;
  missing_pct: number;
  invalid_numeric_count: number;
  min?: number | null;
  max?: number | null;
  mean?: number | null;
  median?: number | null;
  std?: number | null;
  sample_values: (string | number | null)[];
}

export interface DatasetRecord {
  id: number;
  name: string;
  source: string;
  license_info: string;
  is_demo: boolean;
  uploaded_at: string;
  row_count: number;
  column_count: number;
  duplicate_count: number;
  invalid_numeric_total: number;
  column_schema: ColumnSchemaItem[];
  date_range: {
    start: string | null;
    end: string | null;
  };
  location_count: number;
  locations: string[];
  missing_pct: number;
  target_column: string;
  feature_columns: string[];
  validation_status: 'Valid' | 'Valid with Warnings' | 'Invalid';
  validation_notes: string[];
}

export interface ObservationRow {
  date: string;
  location: string;
  station_code?: string;
  latitude: number | null;
  longitude: number | null;
  pm25: number | null;
  pm10: number | null;
  no2: number | null;
  so2: number | null;
  co: number | null;
  o3: number | null;
  temperature_c: number | null;
  humidity_pct: number | null;
  wind_speed_ms: number | null;
  rainfall_mm: number | null;
  green_index_ndvi?: number | null;
  [key: string]: string | number | null | undefined;
}

export interface FeatureImportanceItem {
  feature: string;
  label: string;
  impurity_importance: number;
  permutation_importance_mae: number;
}

export interface FeatureBounds {
  min: number;
  p05: number;
  median: number;
  mean: number;
  std: number;
  p95: number;
  max: number;
}

export interface ModelMetrics {
  mae: number;
  rmse: number;
  r2: number;
  linear_baseline_mae: number;
  linear_baseline_rmse: number;
  persistence_baseline_mae: number | null;
  persistence_baseline_rmse: number | null;
  mean_baseline_mae: number;
  mean_baseline_rmse: number;
  improvement_vs_linear_pct: number;
  improvement_vs_mean_pct: number;
}

export interface EvaluationPoint {
  date: string;
  location: string;
  actual: number;
  predicted_rf: number;
  predicted_linear: number;
  residual: number;
}

export interface ResidualBin {
  bin_label: string;
  bin_center: number;
  count: number;
}

export interface ModelVersionRecord {
  id: number;
  dataset_id: number;
  dataset_name?: string;
  is_demo_dataset?: boolean;
  model_name: string;
  version: string;
  algorithm: string;
  task_type: 'Contemporaneous Estimate' | 'Next-Step Lagged Forecast';
  target: string;
  unit: string;
  features: string[];
  hyperparameters: {
    n_estimators: number;
    max_depth: number;
    min_samples_leaf: number;
    train_ratio: number;
  };
  training_period: { start: string; end: string };
  test_period: { start: string; end: string };
  dataset_size: number;
  train_size: number;
  test_size: number;
  metrics: ModelMetrics;
  feature_importance: FeatureImportanceItem[];
  feature_bounds: Record<string, FeatureBounds>;
  evaluation_series: EvaluationPoint[];
  residual_histogram: ResidualBin[];
  limitations: string[];
  created_at: string;
  is_active: boolean;
}

export interface EnvironmentalAlert {
  id: string;
  type: 'observed' | 'prediction' | 'data_quality' | 'model_status';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  location?: string;
  timestamp?: string;
  metric_value?: string;
  threshold_ref?: string;
}

export interface LocationSummaryItem {
  location: string;
  latitude: number | null;
  longitude: number | null;
  zone_type: string;
  latest_date: string;
  latest_pm25: number | null;
  latest_pm10: number | null;
  avg_pm25: number | null;
  avg_pm10: number | null;
  avg_no2: number | null;
  avg_temp: number | null;
  avg_wind: number | null;
  observation_count: number;
  missing_pm25_count: number;
  model_estimate_pm25: number | null;
  risk_category: string;
  trend_sparkline: { date: string; pm25: number | null }[];
}

export interface DashboardSummaryResponse {
  dataset: DatasetRecord | null;
  active_model: ModelVersionRecord | null;
  selected_location: string;
  selected_standard: AirQualityStandard;
  kpis: {
    latest_pm25: { value: number | null; date: string | null; location: string; sparkline: number[] };
    latest_pm10: { value: number | null; date: string | null; location: string; sparkline: number[] };
    period_avg_pm25: { value: number | null; start: string | null; end: string | null; count: number; min: number | null; max: number | null };
    location_count: number;
    model_status: { ready: boolean; version: string | null; mae: number | null; rmse: number | null; is_demo: boolean };
    latest_timestamp: string | null;
  };
  time_series: {
    date: string;
    pm25: number | null;
    pm10: number | null;
    no2: number | null;
    so2: number | null;
    o3: number | null;
    co: number | null;
    temperature_c: number | null;
    humidity_pct: number | null;
    wind_speed_ms: number | null;
  }[];
  monthly_patterns: {
    month: string;
    pm25_avg: number | null;
    pm10_avg: number | null;
    no2_avg: number | null;
    record_count: number;
  }[];
  location_comparisons: LocationSummaryItem[];
  evaluation_preview: EvaluationPoint[];
  alerts: EnvironmentalAlert[];
}

export interface PredictionRequestPayload {
  location: string;
  observation_date: string;
  inputs: Record<string, number | null>;
  model_version_id?: number;
  standard?: AirQualityStandard;
}

export interface PredictionRecord {
  id: number;
  model_version_id: number;
  model_version: string;
  model_name: string;
  task_type: string;
  is_demo_model: boolean;
  location: string;
  observation_date: string;
  input_payload: Record<string, number | null>;
  imputed_features: string[];
  extrapolated_features: string[];
  predicted_value: number;
  ensemble_iqr: { p25: number; p75: number; tree_std: number };
  linear_comparison_value: number;
  unit: string;
  reference_category: {
    standard: AirQualityStandard;
    band: string;
    threshold_ugm3: number;
    exceedance_ratio: number;
    severity: 'low' | 'moderate' | 'elevated' | 'critical';
  };
  model_metrics: { mae: number; rmse: number };
  feature_contributions: { feature: string; value: number; training_median: number; importance: number }[];
  warnings: string[];
  limitations: string[];
  created_at: string;
}

export interface ScenarioCompareRequest {
  name?: string;
  location: string;
  baseline_inputs: Record<string, number>;
  modified_inputs: Record<string, number>;
  emissions_adjustment_pct?: number; // Optional explicitly documented sensitivity factor
  model_version_id?: number;
  standard?: AirQualityStandard;
}

export interface ScenarioComparisonResult {
  id?: number;
  name: string;
  location: string;
  model_version_id: number;
  model_version: string;
  is_demo_model: boolean;
  baseline_inputs: Record<string, number>;
  modified_inputs: Record<string, number>;
  baseline_output: number;
  modified_output: number;
  raw_model_modified_output: number;
  emissions_adjustment_pct: number;
  abs_diff: number;
  pct_diff: number;
  unit: string;
  baseline_category: string;
  modified_category: string;
  parameter_deltas: {
    feature: string;
    label: string;
    unit: string;
    baseline: number;
    modified: number;
    delta: number;
    delta_pct: number;
    out_of_bounds: boolean;
    training_min: number;
    training_max: number;
  }[];
  assumptions: string[];
  warnings: string[];
  created_at: string;
}

export interface RecommendationItem {
  id: string;
  title: string;
  domain: 'Air Quality' | 'Meteorology & Dispersion' | 'Monitoring & QA/QC' | 'Vegetation & Land Cover' | 'Model Governance';
  environmental_issue: string;
  supporting_data: string;
  evidence_origin: EvidenceOrigin;
  reason: string;
  suggested_action: string;
  priority: 'Critical' | 'High' | 'Moderate' | 'Informational';
  evidence_strength: string;
  rule_reference: string;
  location: string;
}

export interface ReportRecord {
  id: number;
  report_name: string;
  report_type: 'PDF_SUMMARY' | 'CSV_EXPORT';
  location: string;
  date_range: { start: string; end: string };
  created_at: string;
  summary_payload?: {
    dataset_name: string;
    is_demo: boolean;
    observation_count: number;
    mean_pm25: number | null;
    max_pm25: number | null;
    model_version: string | null;
    model_mae: number | null;
    model_rmse: number | null;
    recommendations_count: number;
  };
}
