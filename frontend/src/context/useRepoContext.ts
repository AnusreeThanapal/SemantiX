import { useContext } from 'react';
import { RepoContext } from './RepoContextValue';

export const useRepoContext = () => {
  const context = useContext(RepoContext);
  if (!context) {
    throw new Error('useRepoContext must be used within a RepoProvider');
  }
  return context;
};
