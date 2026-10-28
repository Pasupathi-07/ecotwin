import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { api } from '../lib/api';
import type { RecommendationItem } from '../types/ecotwin';
import { EmptyStatePanel, ErrorBanner, EvidenceLabel, FeedbackNotice } from '../components/Primitives';

export function RecommendationsPage() {
  const { selectedDatasetId, selectedLocation, dateRange, settings } = useWorkspace();

  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string>('All');
  const [domainFilter, setDomainFilter] = useState<string>('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRecommendations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getRecommendations({
        dataset_id: selectedDatasetId,
        location: selectedLocation,
        start_date: dateRange.start || undefined,
        end_date: dateRange.end || undefined,
        standard: settings.standard,
      });
      setRecommendations(res.recommendations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to evaluate rule-based recommendations.');
    } finally {
      setLoading(false);
    }
  }, [selectedDatasetId, selectedLocation, dateRange.start, dateRange.end, settings.standard]);

  useEffect(() => {
    void loadRecommendations();
  }, [loadRecommendations]);

  const domains = useMemo(
    () => ['All', ...Array.from(new Set(recommendations.map((r) => r.domain)))],
    [recommendations]
  );

  const filtered = useMemo(
    () =>
      recommendations.filter((r) => {
        if (priorityFilter !== 'All' && r.priority !== priorityFilter) return false;
        if (domainFilter !== 'All' && r.domain !== domainFilter) return false;
        return true;
      }),
    [recommendations, priorityFilter, domainFilter]
  );

  if (error) {
    return <ErrorBanner message={error} onRetry={loadRecommendations} />;
  }

  return (
    <div className="space-y-6">
      <FeedbackNotice
        variant="info"
        title="Explainable Rule-Based Decision Support (No LLM / No Unverified Causal Claims)"
        message="All advisories below are derived deterministically from threshold comparisons, particulate mass-fraction ratios (PM2.5/PM10), meteorological stagnation indicators, and data-completeness checks. They support environmental investigation and monitoring prioritization, not clinical diagnosis or regulatory certification."
      />

      {/* Filter Controls */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-md bg-[var(--bg-secondary)] border border-[var(--border-subtle)] p-0.5">
            {['All', 'Critical', 'High', 'Moderate', 'Informational'].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriorityFilter(p)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                  priorityFilter === p
                    ? 'bg-[var(--bg-elevated)] text-[var(--accent-teal)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          <select
            aria-label="Filter recommendations by domain"
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
            className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-3 py-1.5 text-xs text-[var(--text-primary)]"
          >
            {domains.map((d) => (
              <option key={d} value={d}>
                {d === 'All' ? 'All Domains' : d}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={loadRecommendations}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] cursor-pointer whitespace-nowrap"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Re-evaluate Rules
        </button>
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div
              key={idx}
              className="h-44 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] animate-pulse"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyStatePanel
          title="No Recommendations Match Current Filter"
          description="Reset the priority or domain filter above to inspect all triggered environmental rules."
          actionLabel="Show All Recommendations"
          onAction={() => {
            setPriorityFilter('All');
            setDomainFilter('All');
          }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map((rec) => {
            const priorityTone =
              rec.priority === 'Critical'
                ? 'text-[var(--accent-red)]'
                : rec.priority === 'High'
                  ? 'text-[var(--accent-amber)]'
                  : rec.priority === 'Moderate'
                    ? 'text-[var(--accent-teal)]'
                    : 'text-[var(--accent-blue)]';

            const priorityGlyph =
              rec.priority === 'Critical'
                ? '✖'
                : rec.priority === 'High'
                  ? '▲'
                  : rec.priority === 'Moderate'
                    ? '◆'
                    : '●';

            return (
              <article
                key={rec.id}
                className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`font-semibold ${priorityTone}`}>
                      {priorityGlyph} {rec.priority} Priority
                    </span>
                    <span aria-hidden="true" className="text-[var(--text-secondary)]">·</span>
                    <span className="text-[var(--text-secondary)]">{rec.domain}</span>
                    <span aria-hidden="true" className="text-[var(--text-secondary)]">·</span>
                    <span className="text-[var(--text-secondary)]">{rec.location}</span>
                  </div>
                  <EvidenceLabel origin={rec.evidence_origin} />
                </div>

                <div>
                  <h2 className="text-base font-semibold text-[var(--text-primary)]">{rec.title}</h2>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                    <strong className="text-[var(--text-primary)]">Environmental Issue:</strong> {rec.environmental_issue}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-[var(--border-subtle)] text-xs">
                  <div className="space-y-1.5">
                    <span className="font-mono text-[11px] text-[var(--text-secondary)] block">
                      Supporting Data & Diagnostic Basis
                    </span>
                    <p className="font-mono text-[var(--text-primary)] leading-relaxed">{rec.supporting_data}</p>
                    <p className="text-[var(--text-secondary)] leading-relaxed">
                      <strong className="text-[var(--text-primary)]">Rationale:</strong> {rec.reason}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <span className="font-mono text-[11px] text-[var(--text-secondary)] block">
                      Recommended Investigation / Action
                    </span>
                    <p className="text-[var(--text-primary)] leading-relaxed">{rec.suggested_action}</p>
                    <div className="pt-1 font-mono text-[11px] text-[var(--text-secondary)]">
                      <div>Evidence Strength: {rec.evidence_strength}</div>
                      <div>Rule Reference: {rec.rule_reference}</div>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
