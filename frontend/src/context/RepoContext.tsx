import React, { createContext, useContext, useState } from 'react';

export type ViewType = 'repo' | 'timeline' | 'graph' | 'hotspots';

interface RepoContextType {
  jobId: string | null;
  repoUrlOrPath: string;
  selectedCommitSha: string | null;
  activeView: ViewType;
  setJobId: (id: string | null) => void;
  setRepoUrlOrPath: (path: string) => void;
  setSelectedCommitSha: (sha: string | null) => void;
  setActiveView: (view: ViewType) => void;
  resetAnalysis: () => void;
}

const RepoContext = createContext<RepoContextType | undefined>(undefined);

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

export const useRepoContext = () => {
  const context = useContext(RepoContext);
  if (!context) {
    throw new Error('useRepoContext must be used within a RepoProvider');
  }
  return context;
};
