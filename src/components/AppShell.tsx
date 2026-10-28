import React, { useState } from 'react';
import {
  Activity,
  Compass,
  Cpu,
  Database,
  FileSpreadsheet,
  FlaskConical,
  LayoutGrid,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { type NavSection, useWorkspace } from '../context/WorkspaceContext';

const NAV_ITEMS: { id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'twin', label: 'Environmental Twin', icon: Compass },
  { id: 'predictions', label: 'AI Predictions', icon: Activity },
  { id: 'scenarios', label: 'Scenario Lab', icon: FlaskConical },
  { id: 'datasets', label: 'Dataset Explorer', icon: Database },
  { id: 'models', label: 'Model Laboratory', icon: Cpu },
  { id: 'recommendations', label: 'Recommendations', icon: ShieldCheck },
  { id: 'reports', label: 'Reports', icon: FileSpreadsheet },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const PAGE_TITLES: Record<NavSection, { title: string; subtitle: string }> = {
  overview: {
    title: 'Environmental Intelligence Overview',
    subtitle: 'Historical air-quality observations, multi-pollutant patterns, and held-out model diagnostics',
  },
  twin: {
    title: 'Environmental Digital-Twin Workspace',
    subtitle: 'Geospatial station observations, model PM2.5 estimates, and historical timeline exploration',
  },
  predictions: {
    title: 'AI PM2.5 Prediction Module',
    subtitle: 'Locally trained Random Forest Regressor estimates with transparent input bounds and evaluation history',
  },
  scenarios: {
    title: 'Hypothetical Scenario Laboratory',
    subtitle: 'Side-by-side baseline versus modified environmental condition comparisons and extrapolation checks',
  },
  datasets: {
    title: 'Dataset Explorer & Quality Audit',
    subtitle: 'CSV ingestion, schema inspection, missing-value diagnostics, and cleaned archive export',
  },
  models: {
    title: 'Machine-Learning Model Laboratory',
    subtitle: 'Chronological train/test validation, MAE/RMSE baselines, residual analysis, and versioned retraining',
  },
  recommendations: {
    title: 'Evidence-Linked Recommendations',
    subtitle: 'Deterministic threshold, particulate-fraction, and monitoring QA/QC decision support rules',
  },
  reports: {
    title: 'Environmental Analysis Reports',
    subtitle: 'Structured PDF and CSV synthesis separating physical observations, ML estimates, and scenarios',
  },
  settings: {
    title: 'Workspace Calibration & Settings',
    subtitle: 'Reference air-quality standards, interface appearance, accessibility, and system diagnostics',
  },
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    activeNav,
    setActiveNav,
    datasets,
    selectedDatasetId,
    setSelectedDatasetId,
    selectedDataset,
    selectedLocation,
    setSelectedLocation,
    activeModel,
    backendHealthy,
    settings,
    updateSettings,
  } = useWorkspace();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const pageMeta = PAGE_TITLES[activeNav];
  const locations = selectedDataset ? ['All Locations', ...selectedDataset.locations] : ['All Locations'];

  const renderSidebarContent = (isMobile = false) => (
    <div className="flex flex-col h-full bg-[var(--bg-secondary)] border-r border-[var(--border-subtle)] select-none">
      {/* Brand Header */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-[var(--border-subtle)] shrink-0">
        {(!collapsed || isMobile) && (
          <button
            type="button"
            onClick={() => {
              setActiveNav('overview');
              setMobileMenuOpen(false);
            }}
            className="flex items-center gap-2.5 text-left cursor-pointer whitespace-nowrap"
          >
            <div className="w-7 h-7 rounded-md bg-[var(--accent-teal)]/15 border border-[var(--accent-teal)]/40 flex items-center justify-center text-[var(--accent-teal)] font-mono text-xs font-bold">
              ET
            </div>
            <span className="text-sm font-bold tracking-tight text-[var(--text-primary)]">
              EcoTwin AI
            </span>
          </button>
        )}

        {isMobile ? (
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation menu"
            className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1.5 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer mx-auto mr-0"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 py-3 px-2.5 space-y-1 overflow-y-auto" aria-label="Main workspace navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeNav === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveNav(item.id);
                setMobileMenuOpen(false);
              }}
              title={collapsed && !isMobile ? item.label : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                active
                  ? 'bg-[var(--bg-elevated)] text-[var(--accent-teal)] border border-[var(--border-subtle)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] border border-transparent'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {(!collapsed || isMobile) && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Quiet Workspace Provenance Footer */}
      {(!collapsed || isMobile) && (
        <div className="p-3.5 border-t border-[var(--border-subtle)] text-[11px] font-mono text-[var(--text-secondary)] space-y-1.5 shrink-0">
          <div className="flex items-center justify-between">
            <span>API Status</span>
            <span className={backendHealthy ? 'text-[var(--accent-teal)]' : 'text-[var(--accent-red)]'}>
              {backendHealthy === null ? 'Checking' : backendHealthy ? 'Connected' : 'Offline'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Active Model</span>
            <span className="text-[var(--text-primary)]">{activeModel ? activeModel.version : 'None'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Last Observed</span>
            <span className="text-[var(--text-primary)]">{selectedDataset?.date_range.end ?? 'N/A'}</span>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:block shrink-0 transition-[width] duration-200 ${
          collapsed ? 'w-[68px]' : 'w-[248px]'
        }`}
      >
        <div className="sticky top-0 h-screen">{renderSidebarContent(false)}</div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 h-full">{renderSidebarContent(true)}</div>
          <div
            className="flex-1 bg-black/55"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: Breadcrumb/Title on left, Global Selectors + Theme Action on right */}
        <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 bg-[var(--bg-secondary)]/95 backdrop-blur border-b border-[var(--border-subtle)] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-1.5 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs font-mono text-[var(--text-secondary)] truncate">
              <span className="hidden sm:inline">EcoTwin AI</span>
              <span className="hidden sm:inline" aria-hidden="true">/</span>
              <span className="font-sans text-sm font-semibold text-[var(--text-primary)] truncate">
                {NAV_ITEMS.find((n) => n.id === activeNav)?.label}
              </span>
            </div>
          </div>

          {/* Global Location, Dataset, and Theme Controls */}
          <div className="flex items-center gap-2.5 shrink-0">
            <label className="sr-only" htmlFor="global-dataset-select">
              Active Dataset
            </label>
            <select
              id="global-dataset-select"
              value={selectedDatasetId ?? ''}
              onChange={(e) => setSelectedDatasetId(Number(e.target.value))}
              className="hidden md:block bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-primary)] max-w-[230px] truncate focus:outline-none focus:border-[var(--accent-teal)] cursor-pointer"
            >
              {datasets.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.name}
                </option>
              ))}
            </select>

            <label className="sr-only" htmlFor="global-location-select">
              Monitoring Location
            </label>
            <select
              id="global-location-select"
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-primary)] max-w-[185px] truncate focus:outline-none focus:border-[var(--accent-teal)] cursor-pointer"
            >
              {locations.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
              aria-label={`Switch to ${settings.theme === 'dark' ? 'light' : 'dark'} theme`}
              className="p-2 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer shrink-0"
            >
              {settings.theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Explicit Provenance Banner when Demo Data is Selected */}
        {selectedDataset?.is_demo && (
          <div className="px-4 sm:px-6 py-2 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-mono text-[var(--accent-amber)]">
              ◇ DEMO DATA — Illustrative or sample data, not live environmental observations.
            </span>
            <span className="text-[var(--text-secondary)]">
              Archive window: <span className="font-mono">{selectedDataset.date_range.start}</span> to{' '}
              <span className="font-mono">{selectedDataset.date_range.end}</span> ·{' '}
              <button
                type="button"
                onClick={() => setActiveNav('datasets')}
                className="underline text-[var(--text-primary)] hover:text-[var(--accent-teal)] cursor-pointer"
              >
                Upload station CSV
              </button>
            </span>
          </div>
        )}

        {/* Page Title Header & Animated Viewport */}
        <main className="flex-1 px-4 sm:px-6 py-6 max-w-[1440px] w-full mx-auto">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)]">
                {pageMeta.title}
              </h1>
              <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1">
                {pageMeta.subtitle}
              </p>
            </div>
            <div className="text-xs font-mono text-[var(--text-secondary)] whitespace-nowrap">
              Standard: {settings.standard === 'CPCB_NAAQS' ? 'CPCB NAAQS (60 ug/m3)' : 'WHO 2021 (15 ug/m3)'}
            </div>
          </div>

          <motion.div
            key={activeNav}
            initial={settings.reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
