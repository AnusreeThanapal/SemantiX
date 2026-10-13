import { createContext } from 'react';
import type { ViewType } from './RepoContext';

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

export const RepoContext = createContext<RepoContextType | undefined>(undefined);
