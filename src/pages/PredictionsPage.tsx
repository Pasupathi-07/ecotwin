import React, { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Download, Sparkles, Wand2 } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { api } from '../lib/api';
import { triggerCsvDownload } from '../lib/exportUtils';
import type { PredictionRecord } from '../types/ecotwin';
import { EmptyStatePanel, ErrorBanner, EvidenceLabel, FeedbackNotice, RiskIndicator } from '../components/Primitives';

const FEATURE_META: Record<string, { label: string; unit: string; step: string }> = {
  pm25_lag1: { label: 'Prior-Day PM2.5 (t-1)', unit: 'ug/m3', step: '0.1' },
  pm10: { label: 'PM10 Concentration', unit: 'ug/m3', step: '0.1' },
  no2: { label: 'Nitrogen Dioxide (NO2)', unit: 'ug/m3', step: '0.1' },
  so2: { label: 'Sulfur Dioxide (SO2)', unit: 'ug/m3', step: '0.1' },
  co: { label: 'Carbon Monoxide (CO)', unit: 'mg/m3', step: '0.01' },
  o3: { label: 'Ground-Level Ozone (O3)', unit: 'ug/m3', step: '0.1' },
  temperature_c: { label: 'Ambient Temperature', unit: 'deg C', step: '0.1' },
  humidity_pct: { label: 'Relative Humidity', unit: '%', step: '0.5' },
  wind_speed_ms: { label: 'Surface Wind Speed', unit: 'm/s', step: '0.1' },
  rainfall_mm: { label: 'Daily Rainfall', unit: 'mm', step: '0.1' },
  green_index_ndvi: { label: 'Vegetation NDVI', unit: 'index', step: '0.01' },
};

const BaseFormSchema = z.object({
  location: z.string().min(1, 'Select a supported station.'),
  observation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter date in YYYY-MM-DD format.'),
  inputs: z.record(z.string(), z.number().finite()),
});

type PredictionFormValues = z.infer<typeof BaseFormSchema>;

export function PredictionsPage() {
  const {
    selectedDataset,
    selectedDatasetId,
    selectedLocation,
    activeModel,
    settings,
    setActiveNav,
  } = useWorkspace();

  const [latestResult, setLatestResult] = useState<PredictionRecord | null>(null);
  const [history, setHistory] = useState<PredictionRecord[]>([]);
  const [historyFilterLoc, setHistoryFilterLoc] = useState<string>('All Locations');
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [prefilling, setPrefilling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultStation =
    selectedLocation !== 'All Locations'
      ? selectedLocation
      : selectedDataset?.locations[0] ?? 'Chennai - Alandur';

  const buildDefaultInputs = useCallback(() => {
    const map: Record<string, number> = {};
    if (!activeModel) return map;
    for (const feat of activeModel.features) {
      map[feat] = Number((activeModel.feature_bounds[feat]?.median ?? 10).toFixed(2));
    }
    return map;
  }, [activeModel]);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PredictionFormValues>({
    resolver: zodResolver(BaseFormSchema),
    defaultValues: {
      location: defaultStation,
      observation_date: selectedDataset?.date_range.end || new Date().toISOString().slice(0, 10),
      inputs: buildDefaultInputs(),
    },
  });

  useEffect(() => {
    reset({
      location: defaultStation,
      observation_date: selectedDataset?.date_range.end || new Date().toISOString().slice(0, 10),
      inputs: buildDefaultInputs(),
    });
  }, [activeModel?.id, defaultStation, selectedDataset?.date_range.end, buildDefaultInputs, reset]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await api.getPredictionHistory({
        location: historyFilterLoc !== 'All Locations' ? historyFilterLoc : undefined,
      });
      setHistory(res.predictions);
    } catch {
      // ignore initial history load error
    }
  }, [historyFilterLoc]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const watchedLocation = watch('location');

  const handlePrefillFromLatestStationRecord = async () => {
    if (!selectedDatasetId || !activeModel) return;
    setPrefilling(true);
    setError(null);
    try {
      const obsRes = await api.getDatasetObservations({
        datasetId: selectedDatasetId,
        location: watchedLocation,
        page: 1,
        page_size: 500,
      });
      const rows = obsRes.observations;
      if (rows.length >= 2) {
        const latest = rows[rows.length - 1];
        const prev = rows[rows.length - 2];
        setValue('observation_date', latest.date);
        for (const feat of activeModel.features) {
          if (feat === 'pm25_lag1') {
            const lagVal = prev.pm25 ?? latest.pm25 ?? activeModel.feature_bounds.pm25_lag1?.median ?? 35;
            setValue(`inputs.${feat}`, Number(Number(lagVal).toFixed(2)));
          } else {
            const val = latest[feat];
            const fallback = activeModel.feature_bounds[feat]?.median ?? 10;
            setValue(
              `inputs.${feat}`,
              Number(Number(typeof val === 'number' ? val : fallback).toFixed(2))
            );
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to prefill station measurements.');
    } finally {
      setPrefilling(false);
    }
  };

  const onSubmit = async (values: PredictionFormValues) => {
    if (!activeModel) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.createPrediction({
        location: values.location,
        observation_date: values.observation_date,
        inputs: values.inputs,
        model_version_id: activeModel.id,
        standard: settings.standard,
      });
      setLatestResult(res.prediction);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute model prediction.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!activeModel) {
    return (
      <EmptyStatePanel
        title="No Active Prediction Model Selected"
        description="Train or activate a Random Forest Regressor in the Model Laboratory before generating PM2.5 estimates."
        actionLabel="Open Model Laboratory"
        onAction={() => setActiveNav('models')}
      />
    );
  }

  const comparedPredictions = history.filter((p) => compareIds.includes(p.id));

  return (
    <div className="space-y-6">
      {error && <ErrorBanner message={error} />}

      {/* Task Definition & Transparency Notice */}
      <FeedbackNotice
        variant="info"
        title={`Task Definition: ${activeModel.task_type} (${activeModel.model_name} ${activeModel.version})`}
        message={
          activeModel.task_type === 'Next-Step Lagged Forecast'
            ? 'Estimates target-day 24-hour PM2.5 concentration from prior-day PM2.5 (t-1) and supplied meteorological/pollutant conditions. Outputs are statistical model estimates, not physical sensor measurements or multi-day weather forecasts.'
            : 'Contemporaneous estimator: estimates 24-hour PM2.5 concentration for supplied environmental input conditions.'
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 6 cols: Validated Prediction Input Form */}
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="lg:col-span-6 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--border-subtle)]">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Environmental Input Conditions
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Required features matched strictly to {activeModel.version} training schema
              </p>
            </div>
            <button
              type="button"
              disabled={prefilling}
              onClick={handlePrefillFromLatestStationRecord}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] hover:border-[var(--accent-teal)] cursor-pointer whitespace-nowrap"
            >
              <Wand2 className="w-3.5 h-3.5 text-[var(--accent-teal)]" />
              {prefilling ? 'Loading...' : 'Prefill Latest Station Values'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pred-location" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Location / Station
              </label>
              <select
                id="pred-location"
                {...register('location')}
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-teal)]"
              >
                {(selectedDataset?.locations || ['Chennai - Alandur']).map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
              {errors.location && (
                <p className="text-[11px] text-[var(--accent-red)] mt-1">{errors.location.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="pred-date" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Target Date
              </label>
              <input
                id="pred-date"
                type="date"
                {...register('observation_date')}
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-teal)]"
              />
              {errors.observation_date && (
                <p className="text-[11px] text-[var(--accent-red)] mt-1">{errors.observation_date.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
            {activeModel.features.map((feat) => {
              const meta = FEATURE_META[feat] || { label: feat, unit: '', step: '0.1' };
              const bounds = activeModel.feature_bounds[feat];
              return (
                <div key={feat}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <label htmlFor={`feat-${feat}`} className="font-medium text-[var(--text-primary)]">
                      {meta.label}
                    </label>
                    <span className="font-mono text-[10px] text-[var(--text-secondary)]">
                      {meta.unit}
                    </span>
                  </div>
                  <input
                    id={`feat-${feat}`}
                    type="number"
                    step={meta.step}
                    {...register(`inputs.${feat}`, { valueAsNumber: true })}
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-3 py-1.5 text-xs font-mono tabular-nums text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-teal)]"
                  />
                  {bounds && (
                    <p className="text-[10px] font-mono text-[var(--text-secondary)] mt-0.5">
                      Train range: [{bounds.min} – {bounds.max}] (med {bounds.median})
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between gap-3">
            <span className="text-[11px] font-mono text-[var(--text-secondary)]">
              Held-out MAE: {activeModel.metrics.mae} ug/m3 · RMSE: {activeModel.metrics.rmse} ug/m3
            </span>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold bg-[var(--accent-teal)] text-[#0B1220] hover:opacity-90 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {submitting ? 'Computing Estimate...' : 'Compute PM2.5 Estimate'}
            </button>
          </div>
        </form>

        {/* Right 6 cols: Prediction Result + Signature "How This Estimate Was Produced" Panel */}
        <div className="lg:col-span-6 space-y-5">
          {latestResult ? (
            <>
              <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <EvidenceLabel
                    origin="Model prediction"
                    detail={`${latestResult.model_version} · ${latestResult.created_at.slice(0, 19).replace('T', ' ')}`}
                  />
                  <RiskIndicator
                    severity={latestResult.reference_category.severity}
                    label={latestResult.reference_category.band}
                  />
                </div>

                <div className="flex flex-wrap items-end justify-between gap-4 py-2 border-y border-[var(--border-subtle)]">
                  <div>
                    <span className="text-xs text-[var(--text-secondary)]">
                      Estimated 24-hr PM2.5 ({latestResult.location} · {latestResult.observation_date})
                    </span>
                    <div className="flex items-baseline mt-1">
                      <span className="text-4xl font-bold font-mono tabular-nums text-[var(--accent-eco)]">
                        {latestResult.predicted_value}
                      </span>
                      <span className="text-sm font-mono text-[var(--text-secondary)] ml-2">
                        {latestResult.unit}
                      </span>
                    </div>
                  </div>

                  <div className="text-right font-mono text-xs space-y-1">
                    <div className="text-[var(--text-secondary)]">
                      Tree Ensemble IQR: <span className="text-[var(--text-primary)]">{latestResult.ensemble_iqr.p25} – {latestResult.ensemble_iqr.p75} ug/m3</span>
                    </div>
                    <div className="text-[var(--text-secondary)]">
                      Ridge Linear Baseline: <span className="text-[var(--text-primary)]">{latestResult.linear_comparison_value} ug/m3</span>
                    </div>
                    <div className="text-[var(--text-secondary)]">
                      Threshold Ratio: <span className="text-[var(--text-primary)]">{latestResult.reference_category.exceedance_ratio}x ({latestResult.reference_category.threshold_ugm3} ug/m3)</span>
                    </div>
                  </div>
                </div>

                {latestResult.warnings.length > 0 && (
                  <div className="p-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--accent-amber)]/40 space-y-1">
                    <p className="text-xs font-semibold text-[var(--accent-amber)]">
                      Input Range & Extrapolation Notices
                    </p>
                    {latestResult.warnings.map((w, idx) => (
                      <p key={idx} className="text-xs text-[var(--text-secondary)]">
                        • {w}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {/* Signature Feature: Model Transparency ("How this estimate was produced") */}
              <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 space-y-4">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  How This Estimate Was Produced
                </h3>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-mono">
                  <div>
                    <span className="text-[var(--text-secondary)] block">Model Version</span>
                    <span className="text-[var(--text-primary)]">{latestResult.model_version}</span>
                  </div>
                  <div>
                    <span className="text-[var(--text-secondary)] block">Training Window</span>
                    <span className="text-[var(--text-primary)]">
                      {activeModel.training_period.start}..{activeModel.training_period.end}
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--text-secondary)] block">Held-Out Error</span>
                    <span className="text-[var(--text-primary)]">
                      MAE {latestResult.model_metrics.mae} / RMSE {latestResult.model_metrics.rmse}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
                  <span className="text-xs font-medium text-[var(--text-secondary)] block">
                    Supplied Inputs vs Training Medians (Ordered by Model Feature Importance)
                  </span>
                  {[...latestResult.feature_contributions]
                    .sort((a, b) => b.importance - a.importance)
                    .slice(0, 6)
                    .map((fc) => (
                      <div key={fc.feature} className="flex items-center justify-between gap-3 text-xs font-mono">
                        <span className="text-[var(--text-primary)] truncate w-44">
                          {FEATURE_META[fc.feature]?.label || fc.feature}
                        </span>
                        <span className="text-[var(--text-secondary)]">
                          Input: <strong className="text-[var(--text-primary)]">{fc.value}</strong> (med {fc.training_median})
                        </span>
                        <span className="text-[var(--accent-teal)] w-16 text-right">
                          {(fc.importance * 100).toFixed(1)}% wt
                        </span>
                      </div>
                    ))}
                </div>

                <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1">
                  <span className="text-xs font-medium text-[var(--text-secondary)] block">
                    Known Model Limitations
                  </span>
                  {latestResult.limitations.map((lim, idx) => (
                    <p key={idx} className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                      • {lim}
                    </p>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-8 text-center">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Ready for Local ML Inference
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-2 max-w-md mx-auto leading-relaxed">
                Supply station parameters on the left or click &ldquo;Prefill Latest Station Values&rdquo; to evaluate {activeModel.model_name} ({activeModel.version}) and inspect ensemble uncertainty bounds.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Prediction History & Multi-Record Comparison */}
      <section className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Persisted Prediction History ({history.length})
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Select two or more rows to compare predictions side by side, or export records to CSV
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <select
              aria-label="Filter prediction history by location"
              value={historyFilterLoc}
              onChange={(e) => setHistoryFilterLoc(e.target.value)}
              className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
            >
              <option value="All Locations">All Locations</option>
              {(selectedDataset?.locations || []).map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={history.length === 0}
              onClick={() =>
                triggerCsvDownload(
                  'ecotwin_prediction_history.csv',
                  history.map((h) => ({
                    id: h.id,
                    created_at: h.created_at,
                    location: h.location,
                    target_date: h.observation_date,
                    predicted_pm25_ugm3: h.predicted_value,
                    iqr_p25: h.ensemble_iqr.p25,
                    iqr_p75: h.ensemble_iqr.p75,
                    linear_baseline_ugm3: h.linear_comparison_value,
                    model_version: h.model_version,
                    reference_band: h.reference_category.band,
                  }))
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] disabled:opacity-40 cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>
        </div>

        {comparedPredictions.length >= 2 && (
          <div className="p-3.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--accent-teal)]/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--accent-teal)]">
                Comparing {comparedPredictions.length} Selected Predictions
              </span>
              <button
                type="button"
                onClick={() => setCompareIds([])}
                className="text-xs font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                Clear comparison
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {comparedPredictions.map((cp) => (
                <div key={cp.id} className="p-2.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-mono">
                  <div className="font-sans font-semibold text-[var(--text-primary)]">{cp.location}</div>
                  <div className="text-[var(--text-secondary)]">{cp.observation_date} · {cp.model_version}</div>
                  <div className="text-base font-bold text-[var(--accent-eco)] mt-1">
                    {cp.predicted_value} {cp.unit}
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)]">{cp.reference_category.band}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {history.length === 0 ? (
          <p className="text-xs font-mono text-[var(--text-secondary)] py-6 text-center">
            No predictions logged yet. Submit the form above to record your first model estimate in SQLite.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[var(--text-secondary)] font-mono">
                  <th className="py-2.5 px-2">Cmp</th>
                  <th className="py-2.5 px-2">Target Date</th>
                  <th className="py-2.5 px-2">Location</th>
                  <th className="py-2.5 px-2 text-right">Estimate (ug/m3)</th>
                  <th className="py-2.5 px-2 text-right">Ensemble IQR</th>
                  <th className="py-2.5 px-2">Model</th>
                  <th className="py-2.5 px-2">Reference Category</th>
                  <th className="py-2.5 px-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {history.map((item) => {
                  const checked = compareIds.includes(item.id);
                  return (
                    <tr key={item.id} className="hover:bg-[var(--bg-elevated)]/40">
                      <td className="py-2.5 px-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          aria-label={`Compare prediction ${item.id}`}
                          onChange={(e) =>
                            setCompareIds((prev) =>
                              e.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id)
                            )
                          }
                          className="accent-[#2DD4BF] cursor-pointer"
                        />
                      </td>
                      <td className="py-2.5 px-2 font-mono tabular-nums">{item.observation_date}</td>
                      <td className="py-2.5 px-2 font-medium text-[var(--text-primary)]">{item.location}</td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums font-semibold text-[var(--accent-eco)]">
                        {item.predicted_value}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                        {item.ensemble_iqr.p25} – {item.ensemble_iqr.p75}
                      </td>
                      <td className="py-2.5 px-2 font-mono">{item.model_version}</td>
                      <td className="py-2.5 px-2 text-[var(--text-secondary)]">{item.reference_category.band}</td>
                      <td className="py-2.5 px-2 text-right">
                        <button
                          type="button"
                          onClick={() => setLatestResult(item)}
                          className="text-xs font-mono text-[var(--accent-teal)] hover:underline cursor-pointer"
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
