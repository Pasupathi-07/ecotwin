import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CheckCircle2, Cpu, Play } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { api } from '../lib/api';
import { ErrorBanner, EvidenceLabel, FeedbackNotice } from '../components/Primitives';

const CANDIDATE_FEATURES = [
  'pm25_lag1',
  'no2',
  'so2',
  'co',
  'o3',
  'temperature_c',
  'humidity_pct',
  'wind_speed_ms',
  'rainfall_mm',
  'pm10',
  'green_index_ndvi',
];

export function ModelLaboratoryPage() {
  const { datasets, selectedDatasetId, models, activeModel, refreshMetadata } = useWorkspace();

  const [inspectedModelId, setInspectedModelId] = useState<number | null>(activeModel?.id ?? null);

  // Training form controls
  const [trainDatasetId, setTrainDatasetId] = useState<number>(selectedDatasetId ?? datasets[0]?.id ?? 1);
  const [trainModelName, setTrainModelName] = useState('EcoTwin Random Forest PM2.5 Regressor');
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([
    'pm25_lag1',
    'no2',
    'so2',
    'co',
    'o3',
    'temperature_c',
    'humidity_pct',
    'wind_speed_ms',
    'rainfall_mm',
  ]);
  const [nEstimators, setNEstimators] = useState(40);
  const [maxDepth, setMaxDepth] = useState(8);
  const [minSamplesLeaf, setMinSamplesLeaf] = useState(4);
  const [trainRatio, setTrainRatio] = useState(0.8);
  const [activateImmediately, setActivateImmediately] = useState(false);

  const [training, setTraining] = useState(false);
  const [activatingId, setActivatingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!inspectedModelId && activeModel) {
      setInspectedModelId(activeModel.id);
    }
  }, [activeModel, inspectedModelId]);

  useEffect(() => {
    if (selectedDatasetId) setTrainDatasetId(selectedDatasetId);
  }, [selectedDatasetId]);

  const inspectedModel = models.find((m) => m.id === inspectedModelId) ?? activeModel;

  const handleTrainSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFeatures.length === 0) {
      setError('Select at least one input feature for training.');
      return;
    }
    setTraining(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.trainModel({
        dataset_id: trainDatasetId,
        model_name: trainModelName,
        target: 'pm25',
        features: selectedFeatures,
        n_estimators: nEstimators,
        max_depth: maxDepth,
        min_samples_leaf: minSamplesLeaf,
        train_ratio: trainRatio,
        activate_immediately: activateImmediately,
      });
      await refreshMetadata();
      setInspectedModelId(res.model.id);
      setNotice(
        `Trained new model version ${res.model.version} (Held-out MAE = ${res.model.metrics.mae} ug/m3, RMSE = ${res.model.metrics.rmse} ug/m3). ${
          activateImmediately ? 'Activated as workspace default.' : 'Saved alongside active model without overwriting.'
        }`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Model training job failed.');
    } finally {
      setTraining(false);
    }
  };

  const handleActivateModel = async (id: number) => {
    setActivatingId(id);
    setError(null);
    try {
      const res = await api.activateModel(id);
      await refreshMetadata();
      setNotice(`Explicitly set ${res.model.version} (${res.model.model_name}) as the active inference model.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not activate selected model version.');
    } finally {
      setActivatingId(null);
    }
  };

  const baselineComparisonChart = inspectedModel
    ? [
        {
          model: 'Mean Baseline',
          MAE: inspectedModel.metrics.mean_baseline_mae,
          RMSE: inspectedModel.metrics.mean_baseline_rmse,
        },
        ...(inspectedModel.metrics.persistence_baseline_mae !== null
          ? [
              {
                model: 'Persistence (t-1)',
                MAE: inspectedModel.metrics.persistence_baseline_mae,
                RMSE: inspectedModel.metrics.persistence_baseline_rmse,
              },
            ]
          : []),
        {
          model: 'Ridge Linear',
          MAE: inspectedModel.metrics.linear_baseline_mae,
          RMSE: inspectedModel.metrics.linear_baseline_rmse,
        },
        {
          model: `Random Forest (${inspectedModel.version})`,
          MAE: inspectedModel.metrics.mae,
          RMSE: inspectedModel.metrics.rmse,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      {error && <ErrorBanner message={error} />}
      {notice && <FeedbackNotice variant="success" title="Model Registry Updated" message={notice} onDismiss={() => setNotice(null)} />}

      {/* Saved Model Versions Registry + Explicit Active Model Selection */}
      <section className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Versioned Model Registry ({models.length})
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Retraining never overwrites prior models. Select any version to inspect metrics or explicitly set it active.
            </p>
          </div>
          <EvidenceLabel origin="Model prediction" detail="Chronological Train/Test Validation" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-[var(--text-secondary)] font-mono">
                <th className="py-2.5 px-2">Version</th>
                <th className="py-2.5 px-2">Model & Dataset</th>
                <th className="py-2.5 px-2">Train / Test Split</th>
                <th className="py-2.5 px-2 text-right">Test MAE</th>
                <th className="py-2.5 px-2 text-right">Test RMSE</th>
                <th className="py-2.5 px-2 text-right">vs Linear</th>
                <th className="py-2.5 px-2">Status</th>
                <th className="py-2.5 px-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {models.map((m) => {
                const isInspected = inspectedModel?.id === m.id;
                return (
                  <tr
                    key={m.id}
                    onClick={() => setInspectedModelId(m.id)}
                    className={`cursor-pointer transition-colors ${
                      isInspected ? 'bg-[var(--bg-elevated)]' : 'hover:bg-[var(--bg-elevated)]/40'
                    }`}
                  >
                    <td className="py-2.5 px-2 font-mono font-semibold text-[var(--accent-teal)]">{m.version}</td>
                    <td className="py-2.5 px-2">
                      <div className="font-medium text-[var(--text-primary)]">{m.model_name}</div>
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        {m.dataset_name || `Dataset #${m.dataset_id}`} ({m.features.length} features)
                      </div>
                    </td>
                    <td className="py-2.5 px-2 font-mono text-[11px] text-[var(--text-secondary)]">
                      <div>Train: {m.training_period.start}..{m.training_period.end} ({m.train_size})</div>
                      <div>Test: {m.test_period.start}..{m.test_period.end} ({m.test_size})</div>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono tabular-nums font-semibold">
                      {m.metrics.mae} {m.unit}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono tabular-nums">
                      {m.metrics.rmse} {m.unit}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono tabular-nums text-[var(--accent-eco)]">
                      {m.metrics.improvement_vs_linear_pct > 0 ? `-${m.metrics.improvement_vs_linear_pct}% err` : `${m.metrics.improvement_vs_linear_pct}%`}
                    </td>
                    <td className="py-2.5 px-2 font-mono">
                      {m.is_active ? (
                        <span className="text-[var(--accent-teal)] inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Active
                        </span>
                      ) : (
                        <span className="text-[var(--text-secondary)]">Staged</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-right" onClick={(ev) => ev.stopPropagation()}>
                      {!m.is_active && (
                        <button
                          type="button"
                          disabled={activatingId === m.id}
                          onClick={() => handleActivateModel(m.id)}
                          className="px-2.5 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:border-[var(--accent-teal)] text-xs font-mono text-[var(--text-primary)] cursor-pointer"
                        >
                          {activatingId === m.id ? 'Activating...' : 'Set Active'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Detailed Evaluation Diagnostics for Inspected Model Version */}
      {inspectedModel && (
        <div className="space-y-6">
          {/* Metric Summary Strip (Strictly Regression MAE, RMSE, R2 — Never Fake Accuracy %) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-4">
              <span className="text-xs text-[var(--text-secondary)]">Random Forest Test MAE</span>
              <div className="mt-1 flex items-baseline">
                <span className="text-2xl font-bold font-mono tabular-nums text-[var(--accent-teal)]">
                  {inspectedModel.metrics.mae}
                </span>
                <span className="text-xs font-mono text-[var(--text-secondary)] ml-1.5">ug/m3</span>
              </div>
              <p className="text-[11px] font-mono text-[var(--text-secondary)] mt-1">
                Linear baseline: {inspectedModel.metrics.linear_baseline_mae} ug/m3
              </p>
            </div>

            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-4">
              <span className="text-xs text-[var(--text-secondary)]">Random Forest Test RMSE</span>
              <div className="mt-1 flex items-baseline">
                <span className="text-2xl font-bold font-mono tabular-nums text-[var(--accent-eco)]">
                  {inspectedModel.metrics.rmse}
                </span>
                <span className="text-xs font-mono text-[var(--text-secondary)] ml-1.5">ug/m3</span>
              </div>
              <p className="text-[11px] font-mono text-[var(--text-secondary)] mt-1">
                Linear baseline: {inspectedModel.metrics.linear_baseline_rmse} ug/m3
              </p>
            </div>

            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-4">
              <span className="text-xs text-[var(--text-secondary)]">Variance Explained (R²)</span>
              <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-[var(--text-primary)]">
                {inspectedModel.metrics.r2}
              </div>
              <p className="text-[11px] font-mono text-[var(--text-secondary)] mt-1">
                Held-out n = {inspectedModel.test_size} rows
              </p>
            </div>

            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-4">
              <span className="text-xs text-[var(--text-secondary)]">Ensemble Configuration</span>
              <div className="mt-1 text-lg font-bold font-mono tabular-nums text-[var(--text-primary)]">
                {inspectedModel.hyperparameters.n_estimators} Trees · Depth {inspectedModel.hyperparameters.max_depth}
              </div>
              <p className="text-[11px] font-mono text-[var(--text-secondary)] mt-1">
                Min leaf: {inspectedModel.hyperparameters.min_samples_leaf} · Split: {Math.round(inspectedModel.hyperparameters.train_ratio * 100)}/{Math.round((1 - inspectedModel.hyperparameters.train_ratio) * 100)}
              </p>
            </div>
          </div>

          {/* Evaluation Visualizations Row 1: Actual vs Predicted + Baseline Error Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Actual vs Predicted PM2.5 on Held-Out Chronological Test Set ({inspectedModel.version})
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5 mb-4">
                Test window: {inspectedModel.test_period.start} to {inspectedModel.test_period.end}
              </p>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={inspectedModel.evaluation_series.slice(-90)}
                    margin={{ top: 6, right: 16, left: 0, bottom: 4 }}
                  >
                    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                      minTickGap={26}
                    />
                    <YAxis
                      tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                      width={42}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--tooltip-bg)',
                        borderColor: 'var(--border-subtle)',
                        fontSize: '12px',
                        fontFamily: 'JetBrains Mono',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Line type="monotone" dataKey="actual" name="Observed PM2.5" stroke="#60A5FA" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="predicted_rf" name="Random Forest" stroke="#2DD4BF" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="predicted_linear" name="Ridge Baseline" stroke="#94A3B8" strokeWidth={1.25} strokeDasharray="3 3" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="lg:col-span-5 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Baseline vs Candidate Error Comparison (ug/m3)
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5 mb-4">
                Lower MAE and RMSE on identical held-out test records indicate better generalization
              </p>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={baselineComparisonChart} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="model" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} />
                    <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontFamily: 'JetBrains Mono' }} width={40} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--tooltip-bg)',
                        borderColor: 'var(--border-subtle)',
                        fontSize: '12px',
                        fontFamily: 'JetBrains Mono',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar dataKey="MAE" fill="#2DD4BF" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="RMSE" fill="#60A5FA" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Evaluation Visualizations Row 2: Permutation Feature Importance + Residual Distribution + Retraining Form */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Permutation Feature Importance
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5 mb-4">
                Increase in held-out test MAE (ug/m3) when each feature is randomly permuted
              </p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={inspectedModel.feature_importance}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fill: 'var(--text-secondary)', fontSize: 10, fontFamily: 'JetBrains Mono' }} />
                    <YAxis dataKey="feature" type="category" width={96} tick={{ fill: 'var(--text-primary)', fontSize: 10, fontFamily: 'JetBrains Mono' }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--tooltip-bg)',
                        borderColor: 'var(--border-subtle)',
                        fontSize: '11px',
                        fontFamily: 'JetBrains Mono',
                      }}
                    />
                    <Bar dataKey="permutation_importance_mae" name="+MAE Impact (ug/m3)" fill="#A3E635" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="lg:col-span-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Residual Error Distribution (Actual - Predicted)
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5 mb-4">
                Symmetric centering near 0 ug/m3 indicates low systematic bias
              </p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={inspectedModel.residual_histogram} margin={{ top: 4, right: 10, left: -8, bottom: 4 }}>
                    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="bin_center" tick={{ fill: 'var(--text-secondary)', fontSize: 10, fontFamily: 'JetBrains Mono' }} />
                    <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 10, fontFamily: 'JetBrains Mono' }} width={36} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--tooltip-bg)',
                        borderColor: 'var(--border-subtle)',
                        fontSize: '11px',
                        fontFamily: 'JetBrains Mono',
                      }}
                    />
                    <Bar dataKey="count" name="Test Records" fill="#60A5FA" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Train New Version Form */}
            <form
              onSubmit={handleTrainSubmit}
              className="lg:col-span-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 space-y-3.5"
            >
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-[var(--accent-teal)]" />
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Train New Model Version
                </h3>
              </div>

              <div>
                <label htmlFor="tr-ds" className="block text-xs text-[var(--text-secondary)] mb-1">
                  Training Dataset
                </label>
                <select
                  id="tr-ds"
                  value={trainDatasetId}
                  onChange={(e) => setTrainDatasetId(Number(e.target.value))}
                  className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                >
                  {datasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.row_count} rows)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="tr-name" className="block text-xs text-[var(--text-secondary)] mb-1">
                  Model Label
                </label>
                <input
                  id="tr-name"
                  type="text"
                  value={trainModelName}
                  onChange={(e) => setTrainModelName(e.target.value)}
                  className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label htmlFor="tr-trees" className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                    Trees
                  </label>
                  <input
                    id="tr-trees"
                    type="number"
                    min={10}
                    max={80}
                    value={nEstimators}
                    onChange={(e) => setNEstimators(Number(e.target.value))}
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2 py-1 text-xs font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="tr-depth" className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                    Max Depth
                  </label>
                  <input
                    id="tr-depth"
                    type="number"
                    min={3}
                    max={14}
                    value={maxDepth}
                    onChange={(e) => setMaxDepth(Number(e.target.value))}
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2 py-1 text-xs font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="tr-split" className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                    Train %
                  </label>
                  <input
                    id="tr-split"
                    type="number"
                    min={0.6}
                    max={0.9}
                    step={0.05}
                    value={trainRatio}
                    onChange={(e) => setTrainRatio(Number(e.target.value))}
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2 py-1 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <span className="block text-xs text-[var(--text-secondary)] mb-1.5">
                  Candidate Input Features
                </span>
                <div className="grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
                  {CANDIDATE_FEATURES.map((feat) => {
                    const checked = selectedFeatures.includes(feat);
                    return (
                      <label key={feat} className="flex items-center gap-1.5 text-[11px] font-mono cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setSelectedFeatures((prev) =>
                              e.target.checked ? [...prev, feat] : prev.filter((f) => f !== feat)
                            )
                          }
                          className="accent-[#2DD4BF]"
                        />
                        <span className="truncate">{feat}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={activateImmediately}
                  onChange={(e) => setActivateImmediately(e.target.checked)}
                  className="accent-[#2DD4BF]"
                />
                Activate new version immediately after evaluation
              </label>

              <button
                type="submit"
                disabled={training}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-xs font-semibold bg-[var(--accent-teal)] text-[#0B1220] hover:opacity-90 disabled:opacity-50 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                {training ? 'Training & Evaluating...' : 'Run Chronological Training'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
