import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowRight, Flame, Layers, Search, Sliders } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { api } from '../lib/api';
import type { DashboardSummaryResponse, ScenarioComparisonResult } from '../types/ecotwin';
import { EnvironmentalMap } from '../components/EnvironmentalMap';
import { EmptyStatePanel, ErrorBanner, EvidenceLabel } from '../components/Primitives';

export function EnvironmentalTwinPage() {
  const {
    selectedDatasetId,
    selectedLocation,
    setSelectedLocation,
    dateRange,
    setDateRange,
    settings,
    setActiveNav,
  } = useWorkspace();

  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [metricMode, setMetricMode] = useState<
    'latest_pm25' | 'avg_pm25' | 'latest_pm10' | 'avg_no2' | 'model_estimate_pm25'
  >('latest_pm25');
  const [showHeatmapPlume, setShowHeatmapPlume] = useState(true);
  const [scenarioModeOpen, setScenarioModeOpen] = useState(false);
  const [windDelta, setWindDelta] = useState<number>(1.5);
  const [no2ScalePct, setNo2ScalePct] = useState<number>(-20);
  const [quickScenarioResult, setQuickScenarioResult] = useState<ScenarioComparisonResult | null>(null);
  const [quickScenarioLoading, setQuickScenarioLoading] = useState(false);

  const loadTwinData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDashboardSummary({
        dataset_id: selectedDatasetId,
        location: selectedLocation,
        start_date: dateRange.start || undefined,
        end_date: dateRange.end || undefined,
        interval: 'daily',
        standard: settings.standard,
      });
      setSummary(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Environmental Twin workspace.');
    } finally {
      setLoading(false);
    }
  }, [selectedDatasetId, selectedLocation, dateRange.start, dateRange.end, settings.standard]);

  useEffect(() => {
    void loadTwinData();
  }, [loadTwinData]);

  const filteredStations = useMemo(() => {
    if (!summary) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return summary.location_comparisons;
    return summary.location_comparisons.filter(
      (s) => s.location.toLowerCase().includes(q) || s.zone_type.toLowerCase().includes(q)
    );
  }, [summary, searchQuery]);

  const focusedStation = useMemo(() => {
    if (!summary || summary.location_comparisons.length === 0) return null;
    if (selectedLocation !== 'All Locations') {
      return summary.location_comparisons.find((s) => s.location === selectedLocation) ?? summary.location_comparisons[0];
    }
    return summary.location_comparisons[0];
  }, [summary, selectedLocation]);

  // Run inline quick scenario estimate when scenario comparison drawer is active
  const runQuickTwinScenario = useCallback(async () => {
    if (!focusedStation || !summary?.active_model) return;
    setQuickScenarioLoading(true);
    try {
      const bounds = summary.active_model.feature_bounds;
      const basePm25 = focusedStation.latest_pm25 ?? focusedStation.avg_pm25 ?? bounds.pm25_lag1?.median ?? 40;
      const baseNo2 = focusedStation.avg_no2 ?? bounds.no2?.median ?? 30;
      const baseWind = focusedStation.avg_wind ?? bounds.wind_speed_ms?.median ?? 3.0;
      const baseTemp = focusedStation.avg_temp ?? bounds.temperature_c?.median ?? 26;

      const baselineInputs: Record<string, number> = {};
      for (const feat of summary.active_model.features) {
        baselineInputs[feat] = bounds[feat]?.median ?? 0;
      }
      if ('pm25_lag1' in baselineInputs) baselineInputs.pm25_lag1 = Number(basePm25.toFixed(1));
      if ('no2' in baselineInputs) baselineInputs.no2 = Number(baseNo2.toFixed(1));
      if ('wind_speed_ms' in baselineInputs) baselineInputs.wind_speed_ms = Number(baseWind.toFixed(2));
      if ('temperature_c' in baselineInputs) baselineInputs.temperature_c = Number(baseTemp.toFixed(1));

      const modifiedInputs: Record<string, number> = { ...baselineInputs };
      if ('wind_speed_ms' in modifiedInputs) {
        modifiedInputs.wind_speed_ms = Number(Math.max(0.3, baseWind + windDelta).toFixed(2));
      }
      if ('no2' in modifiedInputs) {
        modifiedInputs.no2 = Number(Math.max(2, baseNo2 * (1 + no2ScalePct / 100)).toFixed(1));
      }

      const res = await api.compareScenario({
        name: `Twin Overlay: ${focusedStation.location}`,
        location: focusedStation.location,
        baseline_inputs: baselineInputs,
        modified_inputs: modifiedInputs,
        standard: settings.standard,
      });
      setQuickScenarioResult(res.scenario);
    } catch {
      setQuickScenarioResult(null);
    } finally {
      setQuickScenarioLoading(false);
    }
  }, [focusedStation, summary?.active_model, windDelta, no2ScalePct, settings.standard]);

  useEffect(() => {
    if (scenarioModeOpen) {
      void runQuickTwinScenario();
    }
  }, [scenarioModeOpen, runQuickTwinScenario]);

  if (error) {
    return <ErrorBanner message={error} onRetry={loadTwinData} />;
  }

  if (!loading && (!summary || !summary.dataset)) {
    return (
      <EmptyStatePanel
        title="No Geospatial Records Loaded"
        description="Upload a CSV dataset with station coordinates or supported station names to launch the Environmental Twin map."
        actionLabel="Go to Dataset Explorer"
        onAction={() => setActiveNav('datasets')}
      />
    );
  }

  const isDemo = Boolean(summary?.dataset?.is_demo);

  return (
    <div className="space-y-5">
      {/* Top Geospatial Twin Control Bar */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[var(--text-secondary)] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search station or zone..."
              aria-label="Search monitoring station"
              className="pl-8 pr-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md text-xs text-[var(--text-primary)] w-48 focus:outline-none focus:border-[var(--accent-teal)]"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
            <label htmlFor="twin-layer-select" className="sr-only">
              Map Layer Indicator
            </label>
            <select
              id="twin-layer-select"
              value={metricMode}
              onChange={(e) => setMetricMode(e.target.value as typeof metricMode)}
              className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-teal)] cursor-pointer"
            >
              <option value="latest_pm25">Layer: Latest Observed PM2.5</option>
              <option value="avg_pm25">Layer: Period Mean PM2.5</option>
              <option value="model_estimate_pm25">Layer: AI Model PM2.5 Estimate Overlay</option>
              <option value="latest_pm10">Layer: Latest Observed PM10</option>
              <option value="avg_no2">Layer: Period Mean NO2</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => setShowHeatmapPlume((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${
              showHeatmapPlume
                ? 'bg-[var(--bg-elevated)] border-[var(--accent-teal)] text-[var(--accent-teal)]'
                : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)] text-[var(--text-secondary)]'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            Dispersion Halo
          </button>

          <button
            type="button"
            onClick={() => setScenarioModeOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${
              scenarioModeOpen
                ? 'bg-[var(--bg-elevated)] border-[var(--accent-eco)] text-[var(--accent-eco)]'
                : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)] text-[var(--text-secondary)]'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            Scenario Perturbation
          </button>
        </div>

        {/* Historical Timeline Window Controls */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-[var(--text-secondary)] hidden sm:inline">Window:</span>
          <input
            type="date"
            aria-label="Timeline start date"
            value={dateRange.start}
            min={summary?.dataset?.date_range.start ?? undefined}
            max={summary?.dataset?.date_range.end ?? undefined}
            onChange={(e) => setDateRange((prev) => ({ ...prev, start: e.target.value }))}
            className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2 py-1 text-xs text-[var(--text-primary)]"
          />
          <span className="text-[var(--text-secondary)]">to</span>
          <input
            type="date"
            aria-label="Timeline end date"
            value={dateRange.end}
            min={summary?.dataset?.date_range.start ?? undefined}
            max={summary?.dataset?.date_range.end ?? undefined}
            onChange={(e) => setDateRange((prev) => ({ ...prev, end: e.target.value }))}
            className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2 py-1 text-xs text-[var(--text-primary)]"
          />
        </div>
      </div>

      {/* Main Split Workspace: Map (8 cols) + Selected Station Inspection Drawer (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-8 flex flex-col gap-4">
          <EnvironmentalMap
            stations={filteredStations}
            selectedLocation={focusedStation?.location ?? selectedLocation}
            onSelectStation={(loc) => setSelectedLocation(loc)}
            metricMode={metricMode}
            showHeatmapPlume={showHeatmapPlume}
            standard={settings.standard}
            theme={settings.theme}
          />

          {/* Station Quick-Selector Strip Below Map */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-3 overflow-x-auto">
            <div className="flex items-center gap-2 min-w-max">
              {filteredStations.map((st) => {
                const active = focusedStation?.location === st.location;
                return (
                  <button
                    key={st.location}
                    type="button"
                    onClick={() => setSelectedLocation(st.location)}
                    className={`px-3 py-2 rounded-md border text-left transition-colors cursor-pointer ${
                      active
                        ? 'bg-[var(--bg-elevated)] border-[var(--accent-teal)]'
                        : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]'
                    }`}
                  >
                    <div className="text-xs font-medium text-[var(--text-primary)] whitespace-nowrap">
                      {st.location}
                    </div>
                    <div className="text-[11px] font-mono text-[var(--text-secondary)] mt-0.5 whitespace-nowrap">
                      Obs: {st.latest_pm25 ?? 'N/A'} · Est: {st.model_estimate_pm25 ?? 'N/A'} ug/m3
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Selected Station Detail & Twin Comparison Panel */}
        <div className="lg:col-span-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 flex flex-col justify-between gap-5">
          {focusedStation ? (
            <>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <EvidenceLabel
                      origin={
                        metricMode === 'model_estimate_pm25'
                          ? 'Model prediction'
                          : isDemo
                            ? 'Demonstration data'
                            : 'Observed'
                      }
                    />
                    <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                      {focusedStation.latitude?.toFixed(4)}°N, {focusedStation.longitude?.toFixed(4)}°E
                    </span>
                  </div>
                  <h2 className="text-lg font-bold text-[var(--text-primary)] mt-1.5">
                    {focusedStation.location}
                  </h2>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Classification: {focusedStation.zone_type} · Latest record: {focusedStation.latest_date || 'N/A'}
                  </p>
                </div>

                {/* Observation vs Model Twin Readout */}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--border-subtle)]">
                  <div>
                    <span className="block text-[11px] font-mono text-[var(--text-secondary)]">
                      Latest Observed PM2.5
                    </span>
                    <div className="mt-1 flex items-baseline">
                      <span className="text-xl font-bold font-mono tabular-nums text-[var(--text-primary)]">
                        {focusedStation.latest_pm25 ?? 'N/A'}
                      </span>
                      <span className="text-[11px] font-mono text-[var(--text-secondary)] ml-1">ug/m3</span>
                    </div>
                  </div>

                  <div>
                    <span className="block text-[11px] font-mono text-[var(--text-secondary)]">
                      ML Twin Estimate
                    </span>
                    <div className="mt-1 flex items-baseline">
                      <span className="text-xl font-bold font-mono tabular-nums text-[var(--accent-eco)]">
                        {focusedStation.model_estimate_pm25 ?? 'N/A'}
                      </span>
                      <span className="text-[11px] font-mono text-[var(--text-secondary)] ml-1">ug/m3</span>
                    </div>
                  </div>

                  <div>
                    <span className="block text-[11px] font-mono text-[var(--text-secondary)]">
                      Period Mean PM10
                    </span>
                    <span className="text-sm font-mono tabular-nums text-[var(--text-primary)]">
                      {focusedStation.avg_pm10 !== null ? `${focusedStation.avg_pm10} ug/m3` : 'N/A'}
                    </span>
                  </div>

                  <div>
                    <span className="block text-[11px] font-mono text-[var(--text-secondary)]">
                      Mean Wind / Temp
                    </span>
                    <span className="text-sm font-mono tabular-nums text-[var(--text-primary)]">
                      {focusedStation.avg_wind ?? '—'} m/s · {focusedStation.avg_temp ?? '—'} °C
                    </span>
                  </div>
                </div>

                {/* Historical Station Trend */}
                <div className="pt-3 border-t border-[var(--border-subtle)]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-[var(--text-primary)]">
                      Recent 21-Day PM2.5 Trajectory
                    </span>
                    <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                      n={focusedStation.observation_count} total
                    </span>
                  </div>
                  <div className="h-36 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={focusedStation.trend_sparkline}>
                        <XAxis dataKey="date" hide />
                        <YAxis
                          width={34}
                          tick={{ fill: 'var(--text-secondary)', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'var(--tooltip-bg)',
                            borderColor: 'var(--border-subtle)',
                            fontSize: '11px',
                            fontFamily: 'JetBrains Mono',
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="pm25"
                          name="PM2.5"
                          stroke="#2DD4BF"
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Optional Inline Scenario Comparison Drawer */}
                {scenarioModeOpen && (
                  <div className="pt-3 border-t border-[var(--border-subtle)] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[var(--accent-eco)]">
                        Hypothetical Twin Perturbation
                      </span>
                      <EvidenceLabel origin="Hypothetical scenario" />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] font-mono text-[var(--text-secondary)]">
                        <label htmlFor="twin-wind-slider">Wind Speed Delta</label>
                        <span>{windDelta >= 0 ? `+${windDelta}` : windDelta} m/s</span>
                      </div>
                      <input
                        id="twin-wind-slider"
                        type="range"
                        min={-2}
                        max={4}
                        step={0.5}
                        value={windDelta}
                        onChange={(e) => setWindDelta(Number(e.target.value))}
                        className="w-full accent-[#2DD4BF] cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] font-mono text-[var(--text-secondary)]">
                        <label htmlFor="twin-no2-slider">Ambient NO2 Change</label>
                        <span>{no2ScalePct >= 0 ? `+${no2ScalePct}` : no2ScalePct}%</span>
                      </div>
                      <input
                        id="twin-no2-slider"
                        type="range"
                        min={-45}
                        max={45}
                        step={5}
                        value={no2ScalePct}
                        onChange={(e) => setNo2ScalePct(Number(e.target.value))}
                        className="w-full accent-[#A3E635] cursor-pointer"
                      />
                    </div>

                    {quickScenarioResult && !quickScenarioLoading && (
                      <div className="p-2.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs font-mono flex items-center justify-between">
                        <div>
                          <div className="text-[var(--text-secondary)]">Scenario Estimate</div>
                          <div className="text-sm font-bold text-[var(--text-primary)]">
                            {quickScenarioResult.modified_output} ug/m3
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[var(--text-secondary)]">vs Baseline ({quickScenarioResult.baseline_output})</div>
                          <div
                            className={
                              quickScenarioResult.abs_diff <= 0
                                ? 'text-[var(--accent-teal)] font-semibold'
                                : 'text-[var(--accent-amber)] font-semibold'
                            }
                          >
                            {quickScenarioResult.abs_diff > 0 ? '+' : ''}
                            {quickScenarioResult.abs_diff} ug/m3 ({quickScenarioResult.pct_diff}%)
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Provenance & Navigation Actions */}
              <div className="pt-3 border-t border-[var(--border-subtle)] space-y-2.5">
                <div className="text-[11px] font-mono text-[var(--text-secondary)]">
                  Source: {summary?.dataset?.name} · Reference band: {focusedStation.risk_category}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedLocation(focusedStation.location);
                      setActiveNav('predictions');
                    }}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-[var(--accent-teal)] text-[#0B1220] hover:opacity-90 cursor-pointer whitespace-nowrap"
                  >
                    Predict PM2.5
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedLocation(focusedStation.location);
                      setActiveNav('scenarios');
                    }}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] hover:opacity-90 cursor-pointer whitespace-nowrap"
                  >
                    Full Scenario Lab
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="text-xs text-[var(--text-secondary)] py-12 text-center">
              Select a monitoring station on the map to inspect historical trends and model estimates.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
