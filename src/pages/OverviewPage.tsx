import React, { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { RotateCcw } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { api } from '../lib/api';
import type { DashboardSummaryResponse } from '../types/ecotwin';
import { EmptyStatePanel, ErrorBanner, EvidenceLabel, KpiMetricCard } from '../components/Primitives';

type PollutantFocus = 'pm25' | 'pm10' | 'no2' | 'so2' | 'o3';

const POLLUTANT_META: Record<PollutantFocus, { label: string; color: string; unit: string }> = {
  pm25: { label: 'PM2.5 Fine Particulate', color: '#2DD4BF', unit: 'ug/m3' },
  pm10: { label: 'PM10 Coarse Particulate', color: '#60A5FA', unit: 'ug/m3' },
  no2: { label: 'Nitrogen Dioxide (NO2)', color: '#FBBF24', unit: 'ug/m3' },
  so2: { label: 'Sulfur Dioxide (SO2)', color: '#A3E635', unit: 'ug/m3' },
  o3: { label: 'Ozone (O3)', color: '#F87171', unit: 'ug/m3' },
};

export function OverviewPage() {
  const {
    selectedDatasetId,
    selectedLocation,
    setSelectedLocation,
    dateRange,
    setDateRange,
    settings,
    setActiveNav,
  } = useWorkspace();

  const [interval, setIntervalState] = useState<'daily' | 'weekly' | 'monthly'>(settings.defaultAggregation);
  const [pollutantFocus, setPollutantFocus] = useState<PollutantFocus>('pm25');
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDashboardSummary({
        dataset_id: selectedDatasetId,
        location: selectedLocation,
        start_date: dateRange.start || undefined,
        end_date: dateRange.end || undefined,
        interval,
        standard: settings.standard,
      });
      setSummary(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard summary.');
    } finally {
      setLoading(false);
    }
  }, [selectedDatasetId, selectedLocation, dateRange.start, dateRange.end, interval, settings.standard]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  if (error) {
    return <ErrorBanner message={error} onRetry={loadDashboard} />;
  }

  if (loading && !summary) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="h-28 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] animate-pulse"
            />
          ))}
        </div>
        <div className="h-80 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] animate-pulse" />
      </div>
    );
  }

  if (!summary || !summary.dataset) {
    return (
      <EmptyStatePanel
        title="No Environmental Dataset Loaded"
        description="Upload a monitoring CSV archive in Dataset Explorer to inspect historical PM2.5 trends, station comparisons, and model diagnostics."
        actionLabel="Open Dataset Explorer"
        onAction={() => setActiveNav('datasets')}
      />
    );
  }

  const isDemo = summary.dataset.is_demo;
  const dataOrigin = isDemo ? 'Demonstration data' : 'Observed';
  const histOrigin = isDemo ? 'Demonstration data' : 'Historical';
  const pm25Threshold = settings.standard === 'WHO_2021' ? 15 : 60;
  const focusInfo = POLLUTANT_META[pollutantFocus];

  return (
    <div className="space-y-6">
      {/* Interactive Filter Toolbar */}
      <section
        aria-label="Dashboard filters"
        className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-4 flex flex-wrap items-end justify-between gap-4"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="ov-start-date" className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
              Start Date
            </label>
            <input
              id="ov-start-date"
              type="date"
              value={dateRange.start}
              min={summary.dataset.date_range.start ?? undefined}
              max={summary.dataset.date_range.end ?? undefined}
              onChange={(e) => setDateRange((prev) => ({ ...prev, start: e.target.value }))}
              className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-teal)]"
            />
          </div>

          <div>
            <label htmlFor="ov-end-date" className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
              End Date
            </label>
            <input
              id="ov-end-date"
              type="date"
              value={dateRange.end}
              min={summary.dataset.date_range.start ?? undefined}
              max={summary.dataset.date_range.end ?? undefined}
              onChange={(e) => setDateRange((prev) => ({ ...prev, end: e.target.value }))}
              className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-teal)]"
            />
          </div>

          <div>
            <label htmlFor="ov-pollutant" className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
              Primary Pollutant
            </label>
            <select
              id="ov-pollutant"
              value={pollutantFocus}
              onChange={(e) => setPollutantFocus(e.target.value as PollutantFocus)}
              className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-teal)] cursor-pointer"
            >
              {Object.entries(POLLUTANT_META).map(([key, item]) => (
                <option key={key} value={key}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">Aggregation</span>
            <div className="inline-flex rounded-md bg-[var(--bg-secondary)] border border-[var(--border-subtle)] p-0.5">
              {(['daily', 'weekly', 'monthly'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setIntervalState(mode)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors capitalize cursor-pointer whitespace-nowrap ${
                    interval === mode
                      ? 'bg-[var(--bg-elevated)] text-[var(--accent-teal)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setDateRange({ start: '', end: '' });
            setSelectedLocation('All Locations');
            setIntervalState('daily');
            setPollutantFocus('pm25');
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer whitespace-nowrap"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset Filters
        </button>
      </section>

      {/* 6 Data-Driven KPI Cards */}
      <section aria-label="Key environmental metrics" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiMetricCard
          title="Latest PM2.5 Observation"
          value={summary.kpis.latest_pm25.value}
          unit="ug/m3"
          subtitle={
            summary.kpis.latest_pm25.date
              ? `${summary.kpis.latest_pm25.location} · ${summary.kpis.latest_pm25.date}`
              : 'No observation in filter'
          }
          origin={dataOrigin}
          sparkline={summary.kpis.latest_pm25.sparkline}
          sparkColor="#2DD4BF"
        />

        <KpiMetricCard
          title="Latest PM10 Observation"
          value={summary.kpis.latest_pm10.value}
          unit="ug/m3"
          subtitle={
            summary.kpis.latest_pm10.date
              ? `${summary.kpis.latest_pm10.location} · ${summary.kpis.latest_pm10.date}`
              : 'No PM10 column or record'
          }
          origin={dataOrigin}
          sparkline={summary.kpis.latest_pm10.sparkline}
          sparkColor="#60A5FA"
        />

        <KpiMetricCard
          title="Historical Mean PM2.5"
          value={summary.kpis.period_avg_pm25.value}
          unit="ug/m3"
          subtitle={
            summary.kpis.period_avg_pm25.count > 0
              ? `n=${summary.kpis.period_avg_pm25.count} · Min ${summary.kpis.period_avg_pm25.min} / Max ${summary.kpis.period_avg_pm25.max}`
              : 'Zero valid rows in period'
          }
          origin={histOrigin}
        />

        <KpiMetricCard
          title="Supported Locations"
          value={summary.kpis.location_count}
          unit="stations"
          subtitle={`Scope: ${selectedLocation}`}
          origin={histOrigin}
        />

        <KpiMetricCard
          title="Prediction Model Status"
          value={summary.kpis.model_status.ready ? summary.kpis.model_status.version : null}
          unit={summary.kpis.model_status.mae !== null ? `MAE ${summary.kpis.model_status.mae}` : undefined}
          subtitle={
            summary.kpis.model_status.ready
              ? `Held-out RMSE: ${summary.kpis.model_status.rmse} ug/m3`
              : 'Train model in Model Laboratory'
          }
          origin={summary.kpis.model_status.ready ? 'Model prediction' : 'Unavailable'}
        />

        <KpiMetricCard
          title="Latest Dataset Timestamp"
          value={summary.kpis.latest_timestamp}
          subtitle={`Archive start: ${summary.dataset.date_range.start ?? 'N/A'}`}
          origin={histOrigin}
        />
      </section>

      {/* Environmental Alerts Separating Observed vs Model Prediction Alerts */}
      {summary.alerts.length > 0 && (
        <section
          aria-label="Environmental and data quality alerts"
          className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Environmental & Diagnostic Alerts
            </h2>
            <span className="text-xs font-mono text-[var(--text-secondary)]">
              Observed readings and ML estimates reported separately
            </span>
          </div>

          <div className="divide-y divide-[var(--border-subtle)]">
            {summary.alerts.map((alert) => {
              const tone =
                alert.severity === 'critical'
                  ? 'text-[var(--accent-red)]'
                  : alert.severity === 'warning'
                    ? 'text-[var(--accent-amber)]'
                    : 'text-[var(--accent-blue)]';
              const categoryText =
                alert.type === 'observed'
                  ? isDemo
                    ? 'DEMO OBSERVATION ALERT'
                    : 'OBSERVED VALUE ALERT'
                  : alert.type === 'prediction'
                    ? 'MODEL PREDICTION ALERT'
                    : alert.type === 'model_status'
                      ? 'MODEL STATUS'
                      : 'DATA QUALITY NOTICE';

              return (
                <div key={alert.id} className="py-2.5 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-mono">
                      <span className={tone}>{categoryText}</span>
                      {alert.timestamp && (
                        <>
                          <span aria-hidden="true" className="text-[var(--text-secondary)]">·</span>
                          <span className="text-[var(--text-secondary)]">{alert.timestamp}</span>
                        </>
                      )}
                    </div>
                    <p className="text-xs font-semibold text-[var(--text-primary)] mt-0.5">{alert.title}</p>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">{alert.message}</p>
                  </div>
                  {alert.metric_value && (
                    <div className="text-right font-mono text-xs shrink-0">
                      <div className={`font-semibold ${tone}`}>{alert.metric_value}</div>
                      {alert.threshold_ref && (
                        <div className="text-[11px] text-[var(--text-secondary)]">{alert.threshold_ref}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Row 1 Charts: Historical PM2.5 + Selected Pollutant Trend & Monthly Seasonal Patterns */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Historical {focusInfo.label} & Co-Pollutant Trend ({interval})
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {selectedLocation} · Dashed threshold shows {settings.standard === 'WHO_2021' ? 'WHO 2021 (15 ug/m3)' : 'CPCB NAAQS (60 ug/m3)'} for PM2.5
              </p>
            </div>
            <EvidenceLabel origin={histOrigin} detail={`${summary.time_series.length} intervals`} />
          </div>

          {summary.time_series.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-xs font-mono text-[var(--text-secondary)]">
              No observations match the selected date range and station filter.
            </div>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={summary.time_series} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                    minTickGap={28}
                  />
                  <YAxis
                    tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                    width={44}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--tooltip-bg)',
                      borderColor: 'var(--border-subtle)',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontFamily: 'JetBrains Mono',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  {pollutantFocus === 'pm25' && (
                    <ReferenceLine
                      y={pm25Threshold}
                      stroke="#F87171"
                      strokeDasharray="4 4"
                      label={{
                        value: `${pm25Threshold} ug/m3`,
                        fill: '#F87171',
                        fontSize: 10,
                        position: 'insideTopRight',
                      }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey={pollutantFocus}
                    name={`${focusInfo.label} (${focusInfo.unit})`}
                    stroke={focusInfo.color}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                  {pollutantFocus === 'pm25' && (
                    <Line
                      type="monotone"
                      dataKey="pm10"
                      name="PM10 (ug/m3)"
                      stroke="#60A5FA"
                      strokeWidth={1.5}
                      strokeOpacity={0.75}
                      dot={false}
                      connectNulls
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="lg:col-span-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5">
          <div className="flex items-start justify-between gap-2 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Monthly Pollutant Profile
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Mean PM2.5, PM10, and NO2 by calendar month
              </p>
            </div>
            <EvidenceLabel origin={histOrigin} />
          </div>

          {summary.monthly_patterns.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-xs font-mono text-[var(--text-secondary)]">
              Insufficient monthly records
            </div>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.monthly_patterns} margin={{ top: 8, right: 8, left: -8, bottom: 4 }}>
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                  />
                  <YAxis
                    tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                    width={42}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--tooltip-bg)',
                      borderColor: 'var(--border-subtle)',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontFamily: 'JetBrains Mono',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Bar dataKey="pm25_avg" name="PM2.5" fill="#2DD4BF" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="no2_avg" name="NO2" fill="#FBBF24" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Row 2 Charts: Location-Level Comparison & Held-Out Model Evaluation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5">
          <div className="flex items-start justify-between gap-2 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Station-Level PM2.5 Comparison
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Period mean PM2.5 across monitoring locations (click bar or use global selector)
              </p>
            </div>
            <EvidenceLabel origin={histOrigin} />
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={summary.location_comparisons}
                layout="vertical"
                margin={{ top: 4, right: 18, left: 8, bottom: 4 }}
              >
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                />
                <YAxis
                  dataKey="location"
                  type="category"
                  width={130}
                  tick={{ fill: 'var(--text-primary)', fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--tooltip-bg)',
                    borderColor: 'var(--border-subtle)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontFamily: 'JetBrains Mono',
                  }}
                />
                <Bar
                  dataKey="avg_pm25"
                  name="Mean PM2.5 (ug/m3)"
                  fill="#2DD4BF"
                  radius={[0, 4, 4, 0]}
                  onClick={(entry) => {
                    const payload = entry?.payload as { location?: string } | undefined;
                    if (payload?.location) setSelectedLocation(payload.location);
                  }}
                  className="cursor-pointer"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-7 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Model Prediction vs Observed PM2.5 (Held-Out Test Period)
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {summary.active_model
                  ? `${summary.active_model.model_name} (${summary.active_model.version}) · Test window: ${summary.active_model.test_period.start} to ${summary.active_model.test_period.end}`
                  : 'No active model evaluated'}
              </p>
            </div>
            <EvidenceLabel
              origin={summary.active_model ? 'Model prediction' : 'Unavailable'}
              detail={summary.active_model ? `RMSE ${summary.active_model.metrics.rmse}` : undefined}
            />
          </div>

          {summary.evaluation_preview.length === 0 ? (
            <div className="h-72 flex flex-col items-center justify-center gap-2 text-xs text-[var(--text-secondary)]">
              <p>No held-out evaluation records available for the selected station.</p>
              <button
                type="button"
                onClick={() => setActiveNav('models')}
                className="underline text-[var(--accent-teal)] cursor-pointer"
              >
                Inspect or retrain in Model Laboratory
              </button>
            </div>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={summary.evaluation_preview} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                    width={44}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--tooltip-bg)',
                      borderColor: 'var(--border-subtle)',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontFamily: 'JetBrains Mono',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    name="Observed PM2.5 (Test)"
                    stroke="#60A5FA"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="predicted_rf"
                    name="Random Forest Estimate"
                    stroke="#A3E635"
                    strokeWidth={2}
                    strokeDasharray="4 2"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
