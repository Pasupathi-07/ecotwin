import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import type { AirQualityStandard } from '../types/ecotwin';

export function SettingsPage() {
  const {
    settings,
    updateSettings,
    datasets,
    models,
    activeModel,
    backendHealthy,
    refreshMetadata,
  } = useWorkspace();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left 7 cols: Environmental Standards & Interface Calibration */}
      <div className="lg:col-span-7 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 space-y-5">
        <div className="border-b border-[var(--border-subtle)] pb-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            Environmental Benchmark & Interface Calibration
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Preferences persist locally in your browser and immediately update dashboard thresholds, alerts, and recommendations
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="set-standard" className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
              Reference Air-Quality Standard (24-Hour PM2.5)
            </label>
            <select
              id="set-standard"
              value={settings.standard}
              onChange={(e) => updateSettings({ standard: e.target.value as AirQualityStandard })}
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-xs text-[var(--text-primary)]"
            >
              <option value="CPCB_NAAQS">
                CPCB NAAQS (India National Ambient Standard — 24h PM2.5: 60 ug/m3, PM10: 100 ug/m3)
              </option>
              <option value="WHO_2021">
                WHO 2021 Global Air Quality Guideline (Strict Health Reference — 24h PM2.5: 15 ug/m3)
              </option>
            </select>
            <p className="text-[11px] text-[var(--text-secondary)] mt-1">
              Controls threshold lines on Overview charts, marker risk coloring on the Environmental Twin map, and rule-based exceedances.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[var(--border-subtle)]">
            <div>
              <label htmlFor="set-theme" className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                Color Theme
              </label>
              <select
                id="set-theme"
                value={settings.theme}
                onChange={(e) => updateSettings({ theme: e.target.value as 'dark' | 'light' })}
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-xs text-[var(--text-primary)]"
              >
                <option value="dark">Dark — Scientific Obsidian (#0B1220)</option>
                <option value="light">Light — Clinical Lab Slate (#F8FAFC)</option>
              </select>
            </div>

            <div>
              <label htmlFor="set-agg" className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                Default Time-Series Aggregation
              </label>
              <select
                id="set-agg"
                value={settings.defaultAggregation}
                onChange={(e) =>
                  updateSettings({ defaultAggregation: e.target.value as 'daily' | 'weekly' | 'monthly' })
                }
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-xs text-[var(--text-primary)]"
              >
                <option value="daily">Daily Observations</option>
                <option value="weekly">Weekly Mean</option>
                <option value="monthly">Monthly Mean</option>
              </select>
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t border-[var(--border-subtle)]">
            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <div>
                <span className="text-xs font-semibold text-[var(--text-primary)] block">
                  Compact Data-Table Row Density
                </span>
                <span className="text-[11px] text-[var(--text-secondary)]">
                  Reduces vertical padding in Dataset Explorer and History tables for dense inspection
                </span>
              </div>
              <input
                type="checkbox"
                checked={settings.compactTables}
                onChange={(e) => updateSettings({ compactTables: e.target.checked })}
                className="accent-[#2DD4BF] w-4 h-4"
              />
            </label>

            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <div>
                <span className="text-xs font-semibold text-[var(--text-primary)] block">
                  Reduced Interface Motion
                </span>
                <span className="text-[11px] text-[var(--text-secondary)]">
                  Disables page transition animations in addition to OS prefers-reduced-motion settings
                </span>
              </div>
              <input
                type="checkbox"
                checked={settings.reduceMotion}
                onChange={(e) => updateSettings({ reduceMotion: e.target.checked })}
                className="accent-[#2DD4BF] w-4 h-4"
              />
            </label>
          </div>
        </div>
      </div>

      {/* Right 5 cols: System Diagnostics & Architecture Extensibility */}
      <div className="lg:col-span-5 space-y-5">
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Local Runtime & Persistence Status
            </h2>
            <button
              type="button"
              onClick={() => void refreshMetadata()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs font-mono text-[var(--text-primary)] cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              Verify
            </button>
          </div>

          <dl className="divide-y divide-[var(--border-subtle)] text-xs font-mono">
            <div className="py-2 flex justify-between">
              <dt className="text-[var(--text-secondary)]">Backend API Health</dt>
              <dd className={backendHealthy ? 'text-[var(--accent-teal)]' : 'text-[var(--accent-red)]'}>
                {backendHealthy ? 'Connected (/api/health OK)' : 'Unreachable'}
              </dd>
            </div>
            <div className="py-2 flex justify-between">
              <dt className="text-[var(--text-secondary)]">Local SQLite Engine</dt>
              <dd className="text-[var(--text-primary)]">WAL Mode Enabled</dd>
            </div>
            <div className="py-2 flex justify-between">
              <dt className="text-[var(--text-secondary)]">Registered Datasets</dt>
              <dd className="text-[var(--text-primary)]">{datasets.length}</dd>
            </div>
            <div className="py-2 flex justify-between">
              <dt className="text-[var(--text-secondary)]">Saved Model Versions</dt>
              <dd className="text-[var(--text-primary)]">{models.length}</dd>
            </div>
            <div className="py-2 flex justify-between">
              <dt className="text-[var(--text-secondary)]">Active Model Artifact</dt>
              <dd className="text-[var(--text-primary)]">{activeModel ? activeModel.version : 'None'}</dd>
            </div>
            <div className="py-2 flex justify-between">
              <dt className="text-[var(--text-secondary)]">External Paid APIs / IoT</dt>
              <dd className="text-[var(--accent-teal)]">Zero (100% Local)</dd>
            </div>
          </dl>
        </div>

        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 space-y-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Modular Environmental Domain Support
          </h3>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            EcoTwin AI&apos;s ingestion schema, regression trainer, and rule engine are structured for multi-indicator expansion:
          </p>
          <ul className="text-xs text-[var(--text-secondary)] space-y-1.5 pt-1">
            <li>• <strong className="text-[var(--text-primary)]">Air Quality (Active):</strong> PM2.5, PM10, NO2, SO2, CO, O3</li>
            <li>• <strong className="text-[var(--text-primary)]">Meteorology & Rainfall (Active):</strong> Ambient Temperature, RH, Surface Wind, Daily Precipitation</li>
            <li>• <strong className="text-[var(--text-primary)]">Vegetation Analysis (Supported):</strong> Satellite NDVI column detection & Rule VEG-01</li>
            <li>• <strong className="text-[var(--text-primary)]">Water Quality (Schema Ready):</strong> Upload station CSVs with pH, dissolved oxygen, or turbidity targets in Dataset Explorer</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
