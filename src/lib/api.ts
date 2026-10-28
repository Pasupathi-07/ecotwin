import type {
  AirQualityStandard,
  DashboardSummaryResponse,
  DatasetRecord,
  ModelVersionRecord,
  ObservationRow,
  PredictionRecord,
  PredictionRequestPayload,
  RecommendationItem,
  ReportRecord,
  ScenarioCompareRequest,
  ScenarioComparisonResult,
} from '../types/ecotwin';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    let errMsg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) {
        errMsg = Array.isArray(data.details) && data.details.length > 0
          ? `${data.error} ${data.details.join(' ')}`
          : data.error;
      }
    } catch {
      // fallback to status message
    }
    throw new Error(errMsg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getHealth: () =>
    requestJson<{
      status: string;
      service: string;
      database: string;
      datasets_count: number;
      active_model: { id: number; version: string; algorithm: string; is_demo: boolean } | null;
      timestamp: string;
    }>('/api/health'),

  getDashboardSummary: (params: {
    dataset_id?: number | null;
    location?: string;
    start_date?: string;
    end_date?: string;
    interval?: string;
    standard?: AirQualityStandard;
  }) => {
    const qs = new URLSearchParams();
    if (params.dataset_id) qs.set('dataset_id', String(params.dataset_id));
    if (params.location) qs.set('location', params.location);
    if (params.start_date) qs.set('start_date', params.start_date);
    if (params.end_date) qs.set('end_date', params.end_date);
    if (params.interval) qs.set('interval', params.interval);
    if (params.standard) qs.set('standard', params.standard);
    return requestJson<DashboardSummaryResponse>(`/api/dashboard/summary?${qs.toString()}`);
  },

  getDatasets: () => requestJson<{ datasets: DatasetRecord[] }>('/api/datasets'),

  uploadDataset: (formData: FormData) =>
    requestJson<{ dataset: DatasetRecord }>('/api/datasets/upload', {
      method: 'POST',
      body: formData,
    }),

  getDatasetPreview: (datasetId: number, limit = 50) =>
    requestJson<{ dataset: DatasetRecord; rows: ObservationRow[]; total_rows: number }>(
      `/api/datasets/${datasetId}/preview?limit=${limit}`
    ),

  getDatasetObservations: (params: {
    datasetId: number;
    location?: string;
    start_date?: string;
    end_date?: string;
    page?: number;
    page_size?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.location) qs.set('location', params.location);
    if (params.start_date) qs.set('start_date', params.start_date);
    if (params.end_date) qs.set('end_date', params.end_date);
    if (params.page) qs.set('page', String(params.page));
    if (params.page_size) qs.set('page_size', String(params.page_size));
    return requestJson<{ observations: ObservationRow[]; total: number; page: number; page_size: number }>(
      `/api/datasets/${params.datasetId}/observations?${qs.toString()}`
    );
  },

  deleteDataset: (datasetId: number) =>
    requestJson<{ deleted: boolean; id: number }>(`/api/datasets/${datasetId}`, { method: 'DELETE' }),

  getCleanedDatasetDownloadUrl: (datasetId: number) => `${API_BASE}/api/datasets/${datasetId}/download-cleaned`,

  getModels: () => requestJson<{ models: ModelVersionRecord[] }>('/api/models'),

  getModelMetrics: (modelId?: number) =>
    requestJson<{ model: ModelVersionRecord }>(`/api/models/metrics${modelId ? `?model_id=${modelId}` : ''}`),

  trainModel: (payload: {
    dataset_id: number;
    model_name?: string;
    target?: string;
    features: string[];
    n_estimators: number;
    max_depth: number;
    min_samples_leaf: number;
    train_ratio: number;
    activate_immediately: boolean;
  }) =>
    requestJson<{ model: ModelVersionRecord }>('/api/models/train', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  activateModel: (modelId: number) =>
    requestJson<{ model: ModelVersionRecord }>(`/api/models/${modelId}/activate`, {
      method: 'POST',
    }),

  createPrediction: (payload: PredictionRequestPayload) =>
    requestJson<{ prediction: PredictionRecord }>('/api/predictions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getPredictionHistory: (params?: { location?: string; start_date?: string; end_date?: string }) => {
    const qs = new URLSearchParams();
    if (params?.location) qs.set('location', params.location);
    if (params?.start_date) qs.set('start_date', params.start_date);
    if (params?.end_date) qs.set('end_date', params.end_date);
    return requestJson<{ predictions: PredictionRecord[] }>(`/api/predictions/history?${qs.toString()}`);
  },

  compareScenario: (payload: ScenarioCompareRequest) =>
    requestJson<{ scenario: ScenarioComparisonResult }>('/api/scenarios/compare', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  saveScenario: (payload: ScenarioCompareRequest) =>
    requestJson<{ scenario: ScenarioComparisonResult }>('/api/scenarios/save', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getScenarios: () => requestJson<{ scenarios: ScenarioComparisonResult[] }>('/api/scenarios'),

  deleteScenario: (scenarioId: number) =>
    requestJson<{ deleted: boolean; id: number }>(`/api/scenarios/${scenarioId}`, { method: 'DELETE' }),

  getRecommendations: (params: {
    dataset_id?: number | null;
    location?: string;
    start_date?: string;
    end_date?: string;
    standard?: AirQualityStandard;
  }) => {
    const qs = new URLSearchParams();
    if (params.dataset_id) qs.set('dataset_id', String(params.dataset_id));
    if (params.location) qs.set('location', params.location);
    if (params.start_date) qs.set('start_date', params.start_date);
    if (params.end_date) qs.set('end_date', params.end_date);
    if (params.standard) qs.set('standard', params.standard);
    return requestJson<{ recommendations: RecommendationItem[]; dataset_is_demo: boolean }>(
      `/api/recommendations?${qs.toString()}`
    );
  },

  generateReport: (payload: {
    report_name: string;
    report_type: 'PDF_SUMMARY' | 'CSV_EXPORT';
    dataset_id?: number;
    location: string;
    start_date?: string;
    end_date?: string;
    standard: AirQualityStandard;
  }) =>
    requestJson<{
      report: ReportRecord;
      bundle: {
        report_name: string;
        generated_at: string;
        location: string;
        standard: AirQualityStandard;
        date_range: { start: string; end: string };
        dataset: DatasetRecord;
        summary_statistics: {
          dataset_name: string;
          is_demo: boolean;
          observation_count: number;
          mean_pm25: number | null;
          max_pm25: number | null;
          mean_pm10: number | null;
          mean_no2: number | null;
          model_version: string | null;
          model_mae: number | null;
          model_rmse: number | null;
          recommendations_count: number;
        };
        recent_observations: ObservationRow[];
        active_model: ModelVersionRecord | null;
        predictions: PredictionRecord[];
        scenarios: ScenarioComparisonResult[];
        recommendations: RecommendationItem[];
        disclaimer: string;
      };
    }>('/api/reports/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getReports: () => requestJson<{ reports: ReportRecord[] }>('/api/reports'),
};
