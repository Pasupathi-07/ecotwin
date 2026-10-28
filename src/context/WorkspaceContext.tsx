import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { AirQualityStandard, DatasetRecord, ModelVersionRecord } from '../types/ecotwin';

export type NavSection =
  | 'overview'
  | 'twin'
  | 'predictions'
  | 'scenarios'
  | 'datasets'
  | 'models'
  | 'recommendations'
  | 'reports'
  | 'settings';

interface WorkspaceSettings {
  theme: 'dark' | 'light';
  standard: AirQualityStandard;
  defaultAggregation: 'daily' | 'weekly' | 'monthly';
  compactTables: boolean;
  reduceMotion: boolean;
}

interface WorkspaceContextValue {
  activeNav: NavSection;
  setActiveNav: (nav: NavSection) => void;
  datasets: DatasetRecord[];
  selectedDatasetId: number | null;
  setSelectedDatasetId: (id: number) => void;
  selectedDataset: DatasetRecord | null;
  selectedLocation: string;
  setSelectedLocation: (loc: string) => void;
  dateRange: { start: string; end: string };
  setDateRange: React.Dispatch<React.SetStateAction<{ start: string; end: string }>>;
  models: ModelVersionRecord[];
  activeModel: ModelVersionRecord | null;
  backendHealthy: boolean | null;
  settings: WorkspaceSettings;
  updateSettings: (partial: Partial<WorkspaceSettings>) => void;
  refreshMetadata: () => Promise<void>;
  isLoadingMeta: boolean;
}

const SETTINGS_STORAGE_KEY = 'ecotwin_workspace_settings_v1';

const defaultSettings: WorkspaceSettings = {
  theme: 'dark',
  standard: 'CPCB_NAAQS',
  defaultAggregation: 'daily',
  compactTables: false,
  reduceMotion: false,
};

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [activeNav, setActiveNav] = useState<NavSection>('overview');
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [selectedDatasetId, setSelectedDatasetIdState] = useState<number | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string>('All Locations');
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [models, setModels] = useState<ModelVersionRecord[]>([]);
  const [backendHealthy, setBackendHealthy] = useState<boolean | null>(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState<boolean>(true);

  const [settings, setSettings] = useState<WorkspaceSettings>(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        return { ...defaultSettings, ...JSON.parse(raw) };
      }
    } catch {
      // ignore storage errors
    }
    return defaultSettings;
  });

  useEffect(() => {
    const html = document.documentElement;
    if (settings.theme === 'light') {
      html.classList.remove('dark');
      html.classList.add('light');
    } else {
      html.classList.remove('light');
      html.classList.add('dark');
    }
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore storage errors
    }
  }, [settings]);

  const updateSettings = useCallback((partial: Partial<WorkspaceSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  }, []);

  const refreshMetadata = useCallback(async () => {
    setIsLoadingMeta(true);
    try {
      const [healthRes, dsRes, modRes] = await Promise.all([
        api.getHealth(),
        api.getDatasets(),
        api.getModels(),
      ]);
      setBackendHealthy(healthRes.status === 'ok');
      setDatasets(dsRes.datasets);
      setModels(modRes.models);

      setSelectedDatasetIdState((prevId) => {
        if (prevId && dsRes.datasets.some((d) => d.id === prevId)) {
          return prevId;
        }
        // Prefer user-uploaded dataset if available, otherwise primary demo dataset (lowest id)
        const nonDemo = dsRes.datasets.find((d) => !d.is_demo);
        const primaryDemo = [...dsRes.datasets].sort((a, b) => a.id - b.id)[0];
        return nonDemo?.id ?? primaryDemo?.id ?? null;
      });
    } catch {
      setBackendHealthy(false);
    } finally {
      setIsLoadingMeta(false);
    }
  }, []);

  useEffect(() => {
    void refreshMetadata();
  }, [refreshMetadata]);

  const selectedDataset = useMemo(
    () => datasets.find((d) => d.id === selectedDatasetId) ?? null,
    [datasets, selectedDatasetId]
  );

  // Keep selectedLocation valid when switching datasets
  useEffect(() => {
    if (!selectedDataset) return;
    if (selectedLocation !== 'All Locations' && !selectedDataset.locations.includes(selectedLocation)) {
      setSelectedLocation('All Locations');
    }
  }, [selectedDataset, selectedLocation]);

  const setSelectedDatasetId = useCallback((id: number) => {
    setSelectedDatasetIdState(id);
  }, []);

  const activeModel = useMemo(
    () => models.find((m) => m.is_active) ?? models[0] ?? null,
    [models]
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      activeNav,
      setActiveNav,
      datasets,
      selectedDatasetId,
      setSelectedDatasetId,
      selectedDataset,
      selectedLocation,
      setSelectedLocation,
      dateRange,
      setDateRange,
      models,
      activeModel,
      backendHealthy,
      settings,
      updateSettings,
      refreshMetadata,
      isLoadingMeta,
    }),
    [
      activeNav,
      datasets,
      selectedDatasetId,
      setSelectedDatasetId,
      selectedDataset,
      selectedLocation,
      dateRange,
      models,
      activeModel,
      backendHealthy,
      settings,
      updateSettings,
      refreshMetadata,
      isLoadingMeta,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ctx;
}
