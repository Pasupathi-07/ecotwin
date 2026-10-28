import React from 'react';
import { AlertTriangle, CheckCircle2, Info, RefreshCw, X } from 'lucide-react';
import type { EvidenceOrigin } from '../types/ecotwin';

/**
 * Clean, unboxed semantic provenance indicator (Zero-Pill Discipline).
 * Communicates whether a metric comes from observations, historical averages,
 * ML model predictions, demonstration data, or hypothetical scenarios.
 */
export function EvidenceLabel({
  origin,
  detail,
}: {
  origin: EvidenceOrigin;
  detail?: string;
}) {
  const toneMap: Record<EvidenceOrigin, { glyph: string; colorClass: string }> = {
    Observed: { glyph: '●', colorClass: 'text-[var(--accent-teal)]' },
    Historical: { glyph: '◆', colorClass: 'text-[var(--accent-blue)]' },
    'Model prediction': { glyph: '▲', colorClass: 'text-[var(--accent-eco)]' },
    'Demonstration data': { glyph: '◇', colorClass: 'text-[var(--accent-amber)]' },
    'Hypothetical scenario': { glyph: '◈', colorClass: 'text-[var(--accent-blue)]' },
    Unavailable: { glyph: '○', colorClass: 'text-[var(--text-secondary)]' },
  };

  const { glyph, colorClass } = toneMap[origin];

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--text-secondary)] whitespace-nowrap">
      <span className={colorClass} aria-hidden="true">
        {glyph}
      </span>
      <span className={colorClass}>{origin}</span>
      {detail && (
        <>
          <span aria-hidden="true">·</span>
          <span>{detail}</span>
        </>
      )}
    </span>
  );
}

export function RiskIndicator({
  severity,
  label,
}: {
  severity: 'low' | 'moderate' | 'elevated' | 'critical';
  label: string;
}) {
  const cfg = {
    low: { glyph: '●', cls: 'text-[var(--accent-teal)]' },
    moderate: { glyph: '◆', cls: 'text-[var(--accent-eco)]' },
    elevated: { glyph: '▲', cls: 'text-[var(--accent-amber)]' },
    critical: { glyph: '✖', cls: 'text-[var(--accent-red)]' },
  }[severity];

  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs font-medium ${cfg.cls}`}>
      <span aria-hidden="true">{cfg.glyph}</span>
      <span>{label}</span>
    </span>
  );
}

export function MiniSparkline({
  values,
  stroke = '#2DD4BF',
}: {
  values: number[];
  stroke?: string;
}) {
  if (!values || values.length < 2) {
    return <span className="font-mono text-[11px] text-[var(--text-secondary)]">Insufficient series</span>;
  }

  const width = 92;
  const height = 26;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const pts = values
    .map((v, idx) => {
      const x = (idx / (values.length - 1)) * (width - 4) + 2;
      const y = height - 3 - ((v - min) / range) * (height - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible shrink-0" aria-label="Historical trend sparkline">
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
      />
    </svg>
  );
}

export function KpiMetricCard({
  title,
  value,
  unit,
  subtitle,
  origin,
  sparkline,
  sparkColor = '#2DD4BF',
}: {
  title: string;
  value: string | number | null;
  unit?: string;
  subtitle: string;
  origin: EvidenceOrigin;
  sparkline?: number[];
  sparkColor?: string;
}) {
  const isAvailable = value !== null && value !== undefined && value !== '';

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-4 flex flex-col justify-between gap-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-[var(--text-secondary)]">{title}</span>
        <EvidenceLabel origin={isAvailable ? origin : 'Unavailable'} />
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          {isAvailable ? (
            <div className="flex items-baseline">
              <span className="text-2xl font-semibold font-mono tabular-nums text-[var(--text-primary)]">
                {value}
              </span>
              {unit && (
                <span className="text-xs font-mono text-[var(--text-secondary)] ml-1.5">
                  {unit}
                </span>
              )}
            </div>
          ) : (
            <span className="text-lg font-mono text-[var(--text-secondary)]">Unavailable</span>
          )}
          <p className="text-[11px] font-mono text-[var(--text-secondary)] mt-1 truncate max-w-[220px]">
            {subtitle}
          </p>
        </div>

        {sparkline && sparkline.length >= 2 && (
          <MiniSparkline values={sparkline} stroke={sparkColor} />
        )}
      </div>
    </div>
  );
}

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="bg-[var(--bg-surface)] border border-[var(--accent-red)]/50 rounded-lg p-4 flex items-center justify-between gap-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-[var(--accent-red)] shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">Operation could not be completed</p>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">{message}</p>
        </div>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--bg-elevated)] hover:opacity-90 border border-[var(--border-subtle)] text-[var(--text-primary)] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      )}
    </div>
  );
}

export function FeedbackNotice({
  variant = 'info',
  title,
  message,
  onDismiss,
}: {
  variant?: 'info' | 'success' | 'warning';
  title: string;
  message: string;
  onDismiss?: () => void;
}) {
  const Icon = variant === 'success' ? CheckCircle2 : variant === 'warning' ? AlertTriangle : Info;
  const iconTone =
    variant === 'success'
      ? 'text-[var(--accent-teal)]'
      : variant === 'warning'
        ? 'text-[var(--accent-amber)]'
        : 'text-[var(--accent-blue)]';

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-3.5 flex items-start justify-between gap-3">
      <div className="flex items-start gap-2.5">
        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconTone}`} />
        <div>
          <p className="text-xs font-semibold text-[var(--text-primary)]">{title}</p>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">{message}</p>
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export function EmptyStatePanel({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-8 text-center max-w-xl mx-auto my-6">
      <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
      <p className="text-xs text-[var(--text-secondary)] mt-2 leading-relaxed">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 px-4 py-2 text-xs font-medium rounded-md bg-[var(--accent-teal)] text-[#0B1220] hover:opacity-90 transition-opacity whitespace-nowrap cursor-pointer"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg max-w-md w-full p-5 shadow-xl">
        <h3 id="confirm-dialog-title" className="text-base font-semibold text-[var(--text-primary)]">
          {title}
        </h3>
        <p className="text-xs text-[var(--text-secondary)] mt-2 leading-relaxed">{description}</p>
        <div className="flex items-center justify-end gap-2.5 mt-5">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-2 text-xs font-medium rounded-md border border-[var(--border-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-3.5 py-2 text-xs font-medium rounded-md bg-[var(--accent-red)] text-[#0B1220] hover:opacity-90 cursor-pointer"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
