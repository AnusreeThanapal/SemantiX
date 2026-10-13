import React, { useState } from 'react';
import { RepoContext } from './RepoContextValue';

export type ViewType = 'repo' | 'timeline' | 'graph' | 'hotspots';

export const RepoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [jobId, setJobId] = useState<string | null>(null);
  const [repoUrlOrPath, setRepoUrlOrPath] = useState<string>('./');
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewType>('repo');

  const resetAnalysis = () => {
    setJobId(null);
    setSelectedCommitSha(null);
    setActiveView('repo');
  };

  return (
    <RepoContext.Provider
      value={{
        jobId,
        repoUrlOrPath,
        selectedCommitSha,
        activeView,
        setJobId,
        setRepoUrlOrPath,
        setSelectedCommitSha,
        setActiveView,
        resetAnalysis,
      }}
    >
      {children}
    </RepoContext.Provider>
  );
};
