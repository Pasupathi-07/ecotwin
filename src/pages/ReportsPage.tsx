import React, { useCallback, useEffect, useState } from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { api } from '../lib/api';
import { exportEnvironmentalReportPdf, triggerCsvDownload } from '../lib/exportUtils';
import type { ReportRecord } from '../types/ecotwin';
import { ErrorBanner, EvidenceLabel, FeedbackNotice } from '../components/Primitives';

export function ReportsPage() {
  const {
    selectedDataset,
    selectedDatasetId,
    selectedLocation,
    dateRange,
    activeModel,
    settings,
  } = useWorkspace();

  const [reportName, setReportName] = useState(
    `EcoTwin Environmental Synthesis — ${selectedLocation}`
  );
  const [reportLocation, setReportLocation] = useState(selectedLocation);
  const [startDate, setStartDate] = useState(dateRange.start);
  const [endDate, setEndDate] = useState(dateRange.end);

  const [reportsHistory, setReportsHistory] = useState<ReportRecord[]>([]);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [exportingCsvType, setExportingCsvType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setReportLocation(selectedLocation);
    setReportName(`EcoTwin Environmental Synthesis — ${selectedLocation}`);
  }, [selectedLocation]);

  const loadReports = useCallback(async () => {
    try {
      const res = await api.getReports();
      setReportsHistory(res.reports);
    } catch {
      // ignore initial error
    }
  }, []);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const handleGeneratePdf = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneratingPdf(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.generateReport({
        report_name: reportName || 'EcoTwin Environmental Report',
        report_type: 'PDF_SUMMARY',
        dataset_id: selectedDatasetId ?? undefined,
        location: reportLocation,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        standard: settings.standard,
      });

      exportEnvironmentalReportPdf(res.bundle);
      setNotice(`Generated and downloaded PDF report "${res.report.report_name}".`);
      await loadReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate PDF report.');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleExportObservationsCsv = async () => {
    if (!selectedDatasetId) return;
    setExportingCsvType('observations');
    setError(null);
    try {
      const res = await api.getDatasetObservations({
        datasetId: selectedDatasetId,
        location: reportLocation !== 'All Locations' ? reportLocation : undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        page: 1,
        page_size: 500,
      });

      await api.generateReport({
        report_name: `${reportName} (Filtered Observations CSV)`,
        report_type: 'CSV_EXPORT',
        dataset_id: selectedDatasetId,
        location: reportLocation,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        standard: settings.standard,
      });

      triggerCsvDownload(
        `ecotwin_observations_${reportLocation.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.csv`,
        res.observations as Record<string, unknown>[]
      );
      setNotice(`Downloaded ${res.observations.length} filtered observation row(s) as CSV.`);
      await loadReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV export failed.');
    } finally {
      setExportingCsvType(null);
    }
  };

  const handleExportPredictionsCsv = async () => {
    setExportingCsvType('predictions');
    try {
      const res = await api.getPredictionHistory({
        location: reportLocation !== 'All Locations' ? reportLocation : undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      });
      triggerCsvDownload(
        'ecotwin_predictions_export.csv',
        res.predictions.map((p) => ({
          id: p.id,
          created_at: p.created_at,
          location: p.location,
          target_date: p.observation_date,
          predicted_pm25_ugm3: p.predicted_value,
          iqr_p25: p.ensemble_iqr.p25,
          iqr_p75: p.ensemble_iqr.p75,
          linear_baseline_ugm3: p.linear_comparison_value,
          model_version: p.model_version,
          reference_category: p.reference_category.band,
          origin_type: 'MODEL_ESTIMATE_NOT_MEASUREMENT',
        }))
      );
      setNotice(`Exported ${res.predictions.length} prediction history record(s) to CSV.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prediction CSV export failed.');
    } finally {
      setExportingCsvType(null);
    }
  };

  const handleExportScenariosCsv = async () => {
    setExportingCsvType('scenarios');
    try {
      const res = await api.getScenarios();
      triggerCsvDownload(
        'ecotwin_scenarios_export.csv',
        res.scenarios.map((s) => ({
          id: s.id,
          scenario_name: s.name,
          location: s.location,
          baseline_estimate_ugm3: s.baseline_output,
          scenario_estimate_ugm3: s.modified_output,
          difference_ugm3: s.abs_diff,
          difference_pct: s.pct_diff,
          model_version: s.model_version,
          origin_type: 'HYPOTHETICAL_SCENARIO_ESTIMATE',
          created_at: s.created_at,
        }))
      );
      setNotice(`Exported ${res.scenarios.length} saved scenario comparison(s) to CSV.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scenario CSV export failed.');
    } finally {
      setExportingCsvType(null);
    }
  };

  return (
    <div className="space-y-6">
      {error && <ErrorBanner message={error} />}
      {notice && <FeedbackNotice variant="success" title="Report Exported" message={notice} onDismiss={() => setNotice(null)} />}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 cols: PDF Environmental Report Generator */}
        <form
          onSubmit={handleGeneratePdf}
          className="lg:col-span-7 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 space-y-4"
        >
          <div className="flex items-start justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Generate Structured Environmental Report (PDF)
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Compiles dataset provenance, summary statistics, held-out ML metrics, predictions, scenarios, recommendations, and limitations
              </p>
            </div>
            <EvidenceLabel origin={selectedDataset?.is_demo ? 'Demonstration data' : 'Observed'} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="rep-title" className="block text-xs text-[var(--text-secondary)] mb-1">
                Report Title
              </label>
              <input
                id="rep-title"
                type="text"
                required
                value={reportName}
                onChange={(e) => setReportName(e.target.value)}
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-xs text-[var(--text-primary)]"
              />
            </div>

            <div>
              <label htmlFor="rep-loc" className="block text-xs text-[var(--text-secondary)] mb-1">
                Location Scope
              </label>
              <select
                id="rep-loc"
                value={reportLocation}
                onChange={(e) => setReportLocation(e.target.value)}
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-xs text-[var(--text-primary)]"
              >
                <option value="All Locations">All Locations (Network Synthesis)</option>
                {(selectedDataset?.locations || []).map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block text-xs text-[var(--text-secondary)] mb-1">Active Model Included</span>
              <div className="px-3 py-2 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs font-mono text-[var(--text-primary)] truncate">
                {activeModel ? `${activeModel.version} (MAE ${activeModel.metrics.mae} ug/m3)` : 'None Active'}
              </div>
            </div>

            <div>
              <label htmlFor="rep-start" className="block text-xs text-[var(--text-secondary)] mb-1">
                Start Date (Optional)
              </label>
              <input
                id="rep-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-xs font-mono text-[var(--text-primary)]"
              />
            </div>

            <div>
              <label htmlFor="rep-end" className="block text-xs text-[var(--text-secondary)] mb-1">
                End Date (Optional)
              </label>
              <input
                id="rep-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-xs font-mono text-[var(--text-primary)]"
              />
            </div>
          </div>

          <div className="p-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] space-y-1">
            <div className="font-semibold text-[var(--text-primary)]">Included Report Sections (12-Part Academic Format):</div>
            <p className="leading-relaxed">
              1. Title & Scope · 2. Location & Date Window · 3. Dataset Source & Limitations · 4. Summary Statistics · 5. Historical Trends · 6. Model Target & Schema · 7. Held-Out MAE/RMSE Metrics · 8. Model Estimates · 9. Scenario Comparisons · 10. Rule-Based Recommendations · 11. Assumptions · 12. Standard Citations (WHO 2021 / CPCB NAAQS).
            </p>
          </div>

          <button
            type="submit"
            disabled={generatingPdf}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-xs font-semibold bg-[var(--accent-teal)] text-[#0B1220] hover:opacity-90 disabled:opacity-50 cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            {generatingPdf ? 'Compiling & Exporting PDF...' : 'Generate & Download PDF Report'}
          </button>
        </form>

        {/* Right 5 cols: Direct CSV Data Exports */}
        <div className="lg:col-span-5 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Direct Tabular CSV Exports
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Export raw records with explicit provenance columns for external analysis in Python, R, or Excel
            </p>
          </div>

          <div className="space-y-3">
            <div className="p-3.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-subtle)] flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-[var(--text-primary)]">Filtered Observations CSV</div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  Exports cleaned station observations for {reportLocation}
                </div>
              </div>
              <button
                type="button"
                disabled={exportingCsvType === 'observations'}
                onClick={handleExportObservationsCsv}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-primary)] hover:border-[var(--accent-teal)] cursor-pointer whitespace-nowrap"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-[var(--accent-teal)]" />
                Export CSV
              </button>
            </div>

            <div className="p-3.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-subtle)] flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-[var(--text-primary)]">Model Prediction History CSV</div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  Includes ensemble IQR and explicit MODEL_ESTIMATE tag
                </div>
              </div>
              <button
                type="button"
                disabled={exportingCsvType === 'predictions'}
                onClick={handleExportPredictionsCsv}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-primary)] hover:border-[var(--accent-teal)] cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 text-[var(--accent-eco)]" />
                Export CSV
              </button>
            </div>

            <div className="p-3.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-subtle)] flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-[var(--text-primary)]">Scenario Comparisons CSV</div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  Baseline vs modified scenario estimates & deltas
                </div>
              </div>
              <button
                type="button"
                disabled={exportingCsvType === 'scenarios'}
                onClick={handleExportScenariosCsv}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-primary)] hover:border-[var(--accent-teal)] cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 text-[var(--accent-blue)]" />
                Export CSV
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Generated Reports Audit Log */}
      <section className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 space-y-3">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          Generated Reports Log ({reportsHistory.length})
        </h2>

        {reportsHistory.length === 0 ? (
          <p className="text-xs font-mono text-[var(--text-secondary)] py-6 text-center">
            No reports generated in this workspace session yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[var(--text-secondary)] font-mono">
                  <th className="py-2.5 px-2">Created At</th>
                  <th className="py-2.5 px-2">Report Name</th>
                  <th className="py-2.5 px-2">Format</th>
                  <th className="py-2.5 px-2">Location Scope</th>
                  <th className="py-2.5 px-2">Date Window</th>
                  <th className="py-2.5 px-2 text-right">Mean PM2.5</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {reportsHistory.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2.5 px-2 font-mono text-[var(--text-secondary)]">
                      {r.created_at.slice(0, 19).replace('T', ' ')}
                    </td>
                    <td className="py-2.5 px-2 font-medium text-[var(--text-primary)]">{r.report_name}</td>
                    <td className="py-2.5 px-2 font-mono">{r.report_type}</td>
                    <td className="py-2.5 px-2 text-[var(--text-secondary)]">{r.location}</td>
                    <td className="py-2.5 px-2 font-mono">
                      {r.date_range.start} to {r.date_range.end}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono tabular-nums">
                      {r.summary_payload?.mean_pm25 !== null && r.summary_payload?.mean_pm25 !== undefined
                        ? `${r.summary_payload.mean_pm25} ug/m3`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
