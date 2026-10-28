import React, { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BookmarkPlus, Download, Play, RotateCcw, Trash2 } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { api } from '../lib/api';
import { triggerCsvDownload } from '../lib/exportUtils';
import type { ScenarioComparisonResult } from '../types/ecotwin';
import { EmptyStatePanel, ErrorBanner, EvidenceLabel, FeedbackNotice } from '../components/Primitives';

const PARAM_CONFIG: Record<string, { label: string; unit: string; min: number; max: number; step: number }> = {
  pm25_lag1: { label: 'Prior-Day PM2.5 (t-1)', unit: 'ug/m3', min: 5, max: 260, step: 1 },
  pm10: { label: 'PM10 Coarse Particulate', unit: 'ug/m3', min: 10, max: 400, step: 2 },
  no2: { label: 'Nitrogen Dioxide (NO2)', unit: 'ug/m3', min: 2, max: 140, step: 1 },
  so2: { label: 'Sulfur Dioxide (SO2)', unit: 'ug/m3', min: 1, max: 65, step: 0.5 },
  co: { label: 'Carbon Monoxide (CO)', unit: 'mg/m3', min: 0.1, max: 5.0, step: 0.05 },
  o3: { label: 'Ground-Level Ozone (O3)', unit: 'ug/m3', min: 5, max: 140, step: 1 },
  temperature_c: { label: 'Ambient Temperature', unit: 'deg C', min: 5, max: 46, step: 0.5 },
  humidity_pct: { label: 'Relative Humidity', unit: '%', min: 10, max: 100, step: 1 },
  wind_speed_ms: { label: 'Surface Wind Speed', unit: 'm/s', min: 0.2, max: 12.0, step: 0.2 },
  rainfall_mm: { label: 'Daily Precipitation', unit: 'mm', min: 0, max: 80, step: 0.5 },
  green_index_ndvi: { label: 'Vegetation Index (NDVI)', unit: 'index', min: 0.05, max: 0.85, step: 0.01 },
};

export function ScenarioLabPage() {
  const {
    selectedDataset,
    selectedDatasetId,
    selectedLocation,
    activeModel,
    settings,
    setActiveNav,
  } = useWorkspace();

  const defaultLoc =
    selectedLocation !== 'All Locations'
      ? selectedLocation
      : selectedDataset?.locations[0] ?? 'Chennai - Alandur';

  const [scenarioName, setScenarioName] = useState('Urban NO2 Abatement & Wind Dispersion Test');
  const [location, setLocation] = useState(defaultLoc);
  const [baselineInputs, setBaselineInputs] = useState<Record<string, number>>({});
  const [modifiedInputs, setModifiedInputs] = useState<Record<string, number>>({});
  const [emissionsAdjustmentPct, setEmissionsAdjustmentPct] = useState<number>(0);

  const [comparison, setComparison] = useState<ScenarioComparisonResult | null>(null);
  const [savedScenarios, setSavedScenarios] = useState<ScenarioComparisonResult[]>([]);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Initialize baseline & modified inputs from active model medians or station observations
  const initializeFromStation = useCallback(
    async (locName: string) => {
      if (!activeModel) return;
      const base: Record<string, number> = {};
      for (const feat of activeModel.features) {
        base[feat] = Number((activeModel.feature_bounds[feat]?.median ?? 10).toFixed(2));
      }

      if (selectedDatasetId) {
        try {
          const obsRes = await api.getDatasetObservations({
            datasetId: selectedDatasetId,
            location: locName,
            page: 1,
            page_size: 400,
          });
          const rows = obsRes.observations;
          if (rows.length >= 2) {
            const latest = rows[rows.length - 1];
            const prev = rows[rows.length - 2];
            for (const feat of activeModel.features) {
              if (feat === 'pm25_lag1') {
                const v = prev.pm25 ?? latest.pm25;
                if (typeof v === 'number') base[feat] = Number(v.toFixed(2));
              } else if (typeof latest[feat] === 'number') {
                base[feat] = Number(Number(latest[feat]).toFixed(2));
              }
            }
          }
        } catch {
          // fallback to training medians
        }
      }

      const mod = { ...base };
      if ('no2' in mod) mod.no2 = Number(Math.max(4, base.no2 * 0.78).toFixed(1));
      if ('wind_speed_ms' in mod) mod.wind_speed_ms = Number((base.wind_speed_ms + 1.4).toFixed(1));

      setBaselineInputs(base);
      setModifiedInputs(mod);
      setEmissionsAdjustmentPct(0);
    },
    [activeModel, selectedDatasetId]
  );

  useEffect(() => {
    setLocation(defaultLoc);
    void initializeFromStation(defaultLoc);
  }, [defaultLoc, initializeFromStation]);

  const loadSavedScenarios = useCallback(async () => {
    try {
      const res = await api.getScenarios();
      setSavedScenarios(res.scenarios);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadSavedScenarios();
  }, [loadSavedScenarios]);

  const executeComparison = useCallback(async () => {
    if (!activeModel || Object.keys(baselineInputs).length === 0) return;
    setLoadingCompare(true);
    setError(null);
    try {
      const res = await api.compareScenario({
        name: scenarioName,
        location,
        baseline_inputs: baselineInputs,
        modified_inputs: modifiedInputs,
        emissions_adjustment_pct: emissionsAdjustmentPct,
        model_version_id: activeModel.id,
        standard: settings.standard,
      });
      setComparison(res.scenario);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scenario comparison failed.');
    } finally {
      setLoadingCompare(false);
    }
  }, [activeModel, scenarioName, location, baselineInputs, modifiedInputs, emissionsAdjustmentPct, settings.standard]);

  useEffect(() => {
    if (Object.keys(baselineInputs).length > 0 && Object.keys(modifiedInputs).length > 0) {
      const timer = setTimeout(() => {
        void executeComparison();
      }, 180);
      return () => clearTimeout(timer);
    }
  }, [baselineInputs, modifiedInputs, emissionsAdjustmentPct, executeComparison]);

  const handleSaveScenario = async () => {
    if (!activeModel) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.saveScenario({
        name: scenarioName || `${location} Scenario`,
        location,
        baseline_inputs: baselineInputs,
        modified_inputs: modifiedInputs,
        emissions_adjustment_pct: emissionsAdjustmentPct,
        model_version_id: activeModel.id,
        standard: settings.standard,
      });
      setComparison(res.scenario);
      setNotice(`Saved "${res.scenario.name}" to SQLite scenario history.`);
      await loadSavedScenarios();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save scenario.');
    } finally {
      setSaving(false);
    }
  };

  const handleReloadScenario = (sc: ScenarioComparisonResult) => {
    setScenarioName(sc.name);
    setLocation(sc.location);
    setBaselineInputs(sc.baseline_inputs);
    setModifiedInputs(sc.modified_inputs);
    setEmissionsAdjustmentPct(sc.emissions_adjustment_pct || 0);
    setComparison(sc);
    setNotice(`Loaded saved scenario "${sc.name}".`);
  };

  if (!activeModel) {
    return (
      <EmptyStatePanel
        title="Model Required for Scenario Simulation"
        description="Scenario Lab evaluates perturbations using a real trained regression pipeline rather than hardcoded multipliers. Train or activate a model first."
        actionLabel="Open Model Laboratory"
        onAction={() => setActiveNav('models')}
      />
    );
  }

  const chartData = comparison
    ? [
        { stage: 'Baseline Estimate', value: comparison.baseline_output, fill: '#60A5FA' },
        ...(comparison.emissions_adjustment_pct !== 0
          ? [{ stage: 'Raw ML Perturbed', value: comparison.raw_model_modified_output, fill: '#2DD4BF' }]
          : []),
        {
          stage: 'Modified Scenario Estimate',
          value: comparison.modified_output,
          fill: comparison.abs_diff <= 0 ? '#A3E635' : '#FBBF24',
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      {error && <ErrorBanner message={error} />}
      {notice && <FeedbackNotice variant="success" title="Scenario Updated" message={notice} onDismiss={() => setNotice(null)} />}

      {/* Top Scenario Metadata & Actions Bar */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-3 flex-1 min-w-[260px]">
          <div className="flex-1 min-w-[220px]">
            <label htmlFor="sc-name" className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
              Scenario Title
            </label>
            <input
              id="sc-name"
              type="text"
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-3 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-teal)]"
            />
          </div>

          <div>
            <label htmlFor="sc-loc" className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
              Reference Station
            </label>
            <select
              id="sc-loc"
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                void initializeFromStation(e.target.value);
              }}
              className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-3 py-1.5 text-xs text-[var(--text-primary)] cursor-pointer"
            >
              {(selectedDataset?.locations || ['Chennai - Alandur']).map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setModifiedInputs({ ...baselineInputs });
              setEmissionsAdjustmentPct(0);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Match Baseline
          </button>

          <button
            type="button"
            onClick={executeComparison}
            disabled={loadingCompare}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] cursor-pointer whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5 text-[var(--accent-teal)]" />
            {loadingCompare ? 'Evaluating...' : 'Recompute'}
          </button>

          <button
            type="button"
            onClick={handleSaveScenario}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold bg-[var(--accent-teal)] text-[#0B1220] hover:opacity-90 cursor-pointer whitespace-nowrap"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save Scenario'}
          </button>
        </div>
      </div>

      {/* Side-by-Side Baseline vs Modified Scenario Estimate Cards */}
      {comparison && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--text-secondary)]">Baseline Scenario Estimate</span>
              <EvidenceLabel origin="Model prediction" detail={comparison.model_version} />
            </div>
            <div className="mt-3 flex items-baseline">
              <span className="text-3xl font-bold font-mono tabular-nums text-[var(--accent-blue)]">
                {comparison.baseline_output}
              </span>
              <span className="text-xs font-mono text-[var(--text-secondary)] ml-1.5">{comparison.unit}</span>
            </div>
            <p className="text-xs font-mono text-[var(--text-secondary)] mt-2">{comparison.baseline_category}</p>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--text-secondary)]">Modified Scenario Estimate</span>
              <EvidenceLabel origin="Hypothetical scenario" />
            </div>
            <div className="mt-3 flex items-baseline">
              <span className="text-3xl font-bold font-mono tabular-nums text-[var(--accent-eco)]">
                {comparison.modified_output}
              </span>
              <span className="text-xs font-mono text-[var(--text-secondary)] ml-1.5">{comparison.unit}</span>
            </div>
            <p className="text-xs font-mono text-[var(--text-secondary)] mt-2">{comparison.modified_category}</p>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--text-secondary)]">Estimated Scenario Delta</span>
              <span className="font-mono text-[11px] text-[var(--text-secondary)]">Not proven causal impact</span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span
                className={`text-3xl font-bold font-mono tabular-nums ${
                  comparison.abs_diff < 0
                    ? 'text-[var(--accent-teal)]'
                    : comparison.abs_diff > 0
                      ? 'text-[var(--accent-amber)]'
                      : 'text-[var(--text-primary)]'
                }`}
              >
                {comparison.abs_diff > 0 ? `+${comparison.abs_diff}` : comparison.abs_diff}
              </span>
              <span className="text-xs font-mono text-[var(--text-secondary)]">
                {comparison.unit} ({comparison.pct_diff > 0 ? `+${comparison.pct_diff}` : comparison.pct_diff}%)
              </span>
            </div>
            <p className="text-xs font-mono text-[var(--text-secondary)] mt-2">
              Station: {comparison.location}
            </p>
          </div>
        </div>
      )}

      {/* Main Split: Parameter Perturbation Controls (7 cols) + Chart & Assumptions (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 space-y-4">
          <div className="border-b border-[var(--border-subtle)] pb-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Model Feature Perturbation Controls
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Adjust Baseline or Modified inputs directly. Training range bounds are indicated per variable.
            </p>
          </div>

          <div className="space-y-4">
            {activeModel.features.map((feat) => {
              const cfg = PARAM_CONFIG[feat] || { label: feat, unit: '', min: 0, max: 200, step: 1 };
              const bounds = activeModel.feature_bounds[feat];
              const bVal = baselineInputs[feat] ?? bounds?.median ?? 0;
              const mVal = modifiedInputs[feat] ?? bounds?.median ?? 0;
              const outOfRange = bounds ? mVal < bounds.min || mVal > bounds.max : false;

              return (
                <div
                  key={feat}
                  className="p-3.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-subtle)] space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-xs font-semibold text-[var(--text-primary)]">{cfg.label}</span>
                      {bounds && (
                        <span className="text-[11px] font-mono text-[var(--text-secondary)] ml-2">
                          Train [{bounds.min} – {bounds.max} {cfg.unit}]
                        </span>
                      )}
                    </div>
                    {outOfRange && (
                      <span className="text-[11px] font-mono text-[var(--accent-amber)]">
                        ▲ Extrapolating outside training range
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                    <div className="sm:col-span-4 flex items-center gap-2">
                      <label htmlFor={`base-${feat}`} className="text-[11px] font-mono text-[var(--text-secondary)] w-16">
                        Baseline
                      </label>
                      <input
                        id={`base-${feat}`}
                        type="number"
                        step={cfg.step}
                        value={bVal}
                        onChange={(e) =>
                          setBaselineInputs((prev) => ({
                            ...prev,
                            [feat]: Number(e.target.value) || 0,
                          }))
                        }
                        className="w-24 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1 text-xs font-mono tabular-nums text-[var(--text-primary)]"
                      />
                    </div>

                    <div className="sm:col-span-5">
                      <input
                        type="range"
                        aria-label={`Modified ${cfg.label} slider`}
                        min={bounds ? Math.max(0, Math.floor(bounds.min * 0.7)) : cfg.min}
                        max={bounds ? Math.ceil(bounds.max * 1.25) : cfg.max}
                        step={cfg.step}
                        value={mVal}
                        onChange={(e) =>
                          setModifiedInputs((prev) => ({
                            ...prev,
                            [feat]: Number(e.target.value),
                          }))
                        }
                        className="w-full accent-[#2DD4BF] cursor-pointer"
                      />
                    </div>

                    <div className="sm:col-span-3 flex items-center justify-end gap-1.5">
                      <label htmlFor={`mod-${feat}`} className="text-[11px] font-mono text-[var(--text-secondary)]">
                        Mod
                      </label>
                      <input
                        id={`mod-${feat}`}
                        type="number"
                        step={cfg.step}
                        value={mVal}
                        onChange={(e) =>
                          setModifiedInputs((prev) => ({
                            ...prev,
                            [feat]: Number(e.target.value) || 0,
                          }))
                        }
                        className="w-20 bg-[var(--bg-surface)] border border-[var(--accent-teal)]/50 rounded px-2 py-1 text-xs font-mono tabular-nums text-[var(--text-primary)]"
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Optional Explicitly Documented Parametric Emissions Sensitivity Control */}
            <div className="p-3.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-subtle)] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  Parametric Local Primary Emissions Assumption (Optional)
                </span>
                <span className="text-xs font-mono tabular-nums text-[var(--accent-blue)]">
                  {emissionsAdjustmentPct > 0 ? `+${emissionsAdjustmentPct}` : emissionsAdjustmentPct}%
                </span>
              </div>
              <input
                type="range"
                aria-label="Hypothetical local primary emissions adjustment percentage"
                min={-40}
                max={40}
                step={5}
                value={emissionsAdjustmentPct}
                onChange={(e) => setEmissionsAdjustmentPct(Number(e.target.value))}
                className="w-full accent-[#60A5FA] cursor-pointer"
              />
              <p className="text-[11px] text-[var(--text-secondary)]">
                Documented calculation model: applies a 0.35 local primary PM2.5 mass-fraction multiplier on top of the raw ML estimate. Leave at 0% for pure Random Forest feature perturbation.
              </p>
            </div>
          </div>
        </div>

        {/* Right 5 cols: Comparison Chart, Extrapolation Warnings & Assumptions */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              Baseline vs Scenario Estimate (ug/m3)
            </h3>
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="stage"
                    tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
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
                  <Bar dataKey="value" name="Estimated PM2.5 (ug/m3)" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {comparison && comparison.warnings.length > 0 && (
            <div className="bg-[var(--bg-surface)] border border-[var(--accent-amber)]/50 rounded-lg p-4 space-y-1.5">
              <h3 className="text-xs font-semibold text-[var(--accent-amber)]">
                Extrapolation & Data Provenance Warnings
              </h3>
              {comparison.warnings.map((w, idx) => (
                <p key={idx} className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  • {w}
                </p>
              ))}
            </div>
          )}

          {comparison && (
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 space-y-2.5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Explicit Scenario Assumptions
              </h3>
              {comparison.assumptions.map((a, idx) => (
                <p key={idx} className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  • {a}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Saved Scenario Comparison History */}
      <section className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Saved Scenario History ({savedScenarios.length})
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Reload saved parameter sets into the simulator or export scenario comparisons to CSV
            </p>
          </div>
          <button
            type="button"
            disabled={savedScenarios.length === 0}
            onClick={() =>
              triggerCsvDownload(
                'ecotwin_saved_scenarios.csv',
                savedScenarios.map((s) => ({
                  id: s.id,
                  name: s.name,
                  location: s.location,
                  baseline_pm25_ugm3: s.baseline_output,
                  scenario_pm25_ugm3: s.modified_output,
                  abs_diff_ugm3: s.abs_diff,
                  pct_diff: s.pct_diff,
                  model_version: s.model_version,
                  created_at: s.created_at,
                }))
              )
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] disabled:opacity-40 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export Scenarios CSV
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-[var(--text-secondary)] font-mono">
                <th className="py-2.5 px-2">Scenario Name</th>
                <th className="py-2.5 px-2">Location</th>
                <th className="py-2.5 px-2 text-right">Baseline</th>
                <th className="py-2.5 px-2 text-right">Scenario Estimate</th>
                <th className="py-2.5 px-2 text-right">Difference</th>
                <th className="py-2.5 px-2">Model</th>
                <th className="py-2.5 px-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {savedScenarios.map((sc) => (
                <tr key={sc.id} className="hover:bg-[var(--bg-elevated)]/40">
                  <td className="py-2.5 px-2 font-medium text-[var(--text-primary)]">{sc.name}</td>
                  <td className="py-2.5 px-2 text-[var(--text-secondary)]">{sc.location}</td>
                  <td className="py-2.5 px-2 text-right font-mono tabular-nums">{sc.baseline_output} ug/m3</td>
                  <td className="py-2.5 px-2 text-right font-mono tabular-nums font-semibold text-[var(--accent-eco)]">
                    {sc.modified_output} ug/m3
                  </td>
                  <td
                    className={`py-2.5 px-2 text-right font-mono tabular-nums ${
                      sc.abs_diff <= 0 ? 'text-[var(--accent-teal)]' : 'text-[var(--accent-amber)]'
                    }`}
                  >
                    {sc.abs_diff > 0 ? `+${sc.abs_diff}` : sc.abs_diff} ({sc.pct_diff}%)
                  </td>
                  <td className="py-2.5 px-2 font-mono">{sc.model_version}</td>
                  <td className="py-2.5 px-2 text-right space-x-3">
                    <button
                      type="button"
                      onClick={() => handleReloadScenario(sc)}
                      className="text-xs font-mono text-[var(--accent-teal)] hover:underline cursor-pointer"
                    >
                      Reload
                    </button>
                    {sc.id && (
                      <button
                        type="button"
                        onClick={async () => {
                          await api.deleteScenario(sc.id!);
                          await loadSavedScenarios();
                        }}
                        aria-label={`Delete scenario ${sc.name}`}
                        className="text-[var(--text-secondary)] hover:text-[var(--accent-red)] inline-flex align-middle cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
