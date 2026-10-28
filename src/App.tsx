/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext';
import { AppShell } from './components/AppShell';
import { OverviewPage } from './pages/OverviewPage';
import { EnvironmentalTwinPage } from './pages/EnvironmentalTwinPage';
import { PredictionsPage } from './pages/PredictionsPage';
import { ScenarioLabPage } from './pages/ScenarioLabPage';
import { DatasetExplorerPage } from './pages/DatasetExplorerPage';
import { ModelLaboratoryPage } from './pages/ModelLaboratoryPage';
import { RecommendationsPage } from './pages/RecommendationsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';

function WorkspaceRouter() {
  const { activeNav } = useWorkspace();

  return (
    <AppShell>
      {activeNav === 'overview' && <OverviewPage />}
      {activeNav === 'twin' && <EnvironmentalTwinPage />}
      {activeNav === 'predictions' && <PredictionsPage />}
      {activeNav === 'scenarios' && <ScenarioLabPage />}
      {activeNav === 'datasets' && <DatasetExplorerPage />}
      {activeNav === 'models' && <ModelLaboratoryPage />}
      {activeNav === 'recommendations' && <RecommendationsPage />}
      {activeNav === 'reports' && <ReportsPage />}
      {activeNav === 'settings' && <SettingsPage />}
    </AppShell>
  );
}

export default function App() {
  return (
    <WorkspaceProvider>
      <WorkspaceRouter />
    </WorkspaceProvider>
  );
}
