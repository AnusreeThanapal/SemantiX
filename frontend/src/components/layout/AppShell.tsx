import React from 'react';
import { useRepoContext, type ViewType } from '../../context/RepoContext';

import { FolderGit2, GitCommit, Network, Flame, RefreshCw, Cpu } from 'lucide-react';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const { activeView, setActiveView, repoUrlOrPath, resetAnalysis, jobId } = useRepoContext();

  const navItems: { id: ViewType; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'repo', label: 'Repository Analysis', icon: FolderGit2 },
    { id: 'timeline', label: 'Evolution Timeline', icon: GitCommit },
    { id: 'graph', label: 'Dependency Graph', icon: Network },
    { id: 'hotspots', label: 'Semantic Hotspots', icon: Flame },
  ];

  return (
    <div className="min-h-screen flex bg-[#090d16] text-slate-100 font-sans selection:bg-cyan-500/30">
      {/* Left Sidebar */}
      <aside className="w-64 bg-[#0f172a] border-r border-slate-800/80 flex flex-col shrink-0">
        {/* Brand Logo */}
        <div className="h-16 px-6 border-b border-slate-800/80 flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-500/50 flex items-center justify-center text-cyan-400 shadow-md shadow-cyan-950/50">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <div className="font-semibold tracking-wider text-sm text-slate-100 flex items-center space-x-1.5">
              <span>SemantiX</span>
              <span className="text-[10px] bg-cyan-950 text-cyan-400 border border-cyan-500/30 px-1.5 py-0.2 rounded uppercase font-bold">
                v0.1
              </span>
            </div>
            <div className="text-[11px] text-slate-500 font-normal">
              Visual Evolution Analytics
            </div>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-6 space-y-1.5">
          <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Analytics Views
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            const isDisabled = item.id !== 'repo' && !jobId;

            return (
              <button
                key={item.id}
                onClick={() => !isDisabled && setActiveView(item.id)}
                disabled={isDisabled}
                className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-cyan-950/70 border border-cyan-500/60 text-cyan-300 shadow-sm'
                    : isDisabled
                    ? 'text-slate-600 cursor-not-allowed opacity-50'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* System Info Footer */}
        <div className="p-4 border-t border-slate-800/80 bg-[#0b0f19] text-[11px] text-slate-500 space-y-1">
          <div className="flex items-center justify-between">
            <span>Engine</span>
            <span className="text-slate-400 font-mono">GumTree + D3</span>
          </div>
          <div className="flex items-center justify-between">
            <span>LLM Layer</span>
            <span className="text-slate-400 font-mono">GPT-4o</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-16 bg-[#0f172a]/90 backdrop-blur-md border-b border-slate-800/80 px-8 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center space-x-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Active Context:
            </span>
            <span className="text-xs font-mono bg-[#090d16] border border-slate-800 px-3 py-1 rounded text-slate-300 truncate max-w-md">
              {repoUrlOrPath || './'}
            </span>
          </div>

          <button
            onClick={resetAnalysis}
            className="flex items-center space-x-2 text-xs font-medium text-slate-400 hover:text-cyan-400 bg-[#090d16] hover:bg-slate-800/60 border border-slate-800 hover:border-slate-700 px-3 py-1.5 rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>New Analysis</span>
          </button>
        </header>

        {/* Page Content Body */}
        <main className="flex-1 p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
};
