import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RepoProvider, useRepoContext } from './context/RepoContext';
import { AppShell } from './components/layout/AppShell';
import { RepoInputView } from './components/views/RepoInputView';
import { TimelineView } from './components/views/TimelineView';
import { DependencyGraphView } from './components/views/DependencyGraphView';
import { HotspotHeatmapView } from './components/views/HotspotHeatmapView';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const MainContent: React.FC = () => {
  const { activeView } = useRepoContext();

  switch (activeView) {
    case 'repo':
      return <RepoInputView />;
    case 'timeline':
      return <TimelineView />;
    case 'graph':
      return <DependencyGraphView />;
    case 'hotspots':
      return <HotspotHeatmapView />;
    default:
      return <RepoInputView />;
  }
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <RepoProvider>
        <AppShell>
          <MainContent />
        </AppShell>
      </RepoProvider>
    </QueryClientProvider>
  );
};

export default App;
