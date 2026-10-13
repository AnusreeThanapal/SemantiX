import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { CodeBertStatus, CodeBertInsights } from '../../api/client';
import {
  ChevronDown,
  Sparkles,
  Loader2,
  Info,
  Plus,
  Check,
  AlertCircle,
} from 'lucide-react';

interface CodeBertPanelProps {
  activeSha: string | null;
  insightsData: CodeBertInsights | null;
  isInsightsLoading: boolean;
  insightsError?: string | null;
  onTriggerInsights: () => void;
  addedLatentNodeIds: Set<string>;
  onToggleLatentNode: (
    node: CodeBertInsights['latent_dependencies'][number]
  ) => void;
}

export const CodeBertPanel: React.FC<CodeBertPanelProps> = ({
  activeSha,
  insightsData,
  isInsightsLoading,
  insightsError,
  onTriggerInsights,
  addedLatentNodeIds,
  onToggleLatentNode,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  // Poll status every 2 seconds ONLY while in loading state
  const { data: statusData } = useQuery<CodeBertStatus>({
    queryKey: ['codebert', 'status'],
    queryFn: () => api.getCodeBertStatus(),
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === 'loading' ? 2000 : false;
    },
  });

  const state = statusData?.state || 'unloaded';
  const kind = statusData?.kind || 'fallback-heuristic';
  const device = statusData?.device || 'cpu';

  const renderStatusChip = () => {
    if (state === 'disabled') {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
          Disabled
        </span>
      );
    }
    if (state === 'loading') {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] bg-cyan-950/60 text-cyan-400 border border-cyan-800 flex items-center space-x-1">
          <Loader2 className="w-2.5 h-2.5 animate-spin" />
          <span>Loading model…</span>
        </span>
      );
    }
    if (state === 'ready') {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950/60 text-emerald-400 border border-emerald-800">
          Ready · {device}
        </span>
      );
    }
    if (state === 'fallback' || kind === 'fallback-heuristic') {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] bg-amber-950/60 text-amber-400 border border-amber-800">
          Heuristic fallback — not CodeBERT
        </span>
      );
    }
    if (state === 'error') {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] bg-rose-950/60 text-rose-400 border border-rose-800">
          Error
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800/80 text-slate-400 border border-slate-700">
        Not loaded
      </span>
    );
  };

  const levelColor = (lvl?: string) => {
    if (lvl === 'low') return 'text-emerald-400 bg-emerald-950/50 border-emerald-800';
    if (lvl === 'moderate') return 'text-amber-400 bg-amber-950/50 border-amber-800';
    if (lvl === 'high') return 'text-rose-400 bg-rose-950/50 border-rose-800';
    return 'text-slate-400 bg-slate-800/50 border-slate-700';
  };

  return (
    <div className="bg-[#0f172a] border border-slate-800/80 rounded-xl overflow-hidden transition-all text-xs">
      {/* Collapsible Card Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#0f172a] hover:bg-slate-800/50 transition-colors text-slate-300"
      >
        <div className="flex items-center space-x-2.5">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span className="font-semibold text-slate-200">Semantic Insights (CodeBERT)</span>
          {renderStatusChip()}
        </div>

        <div className="flex items-center space-x-2 text-slate-400">
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Collapsible Content */}
      {isOpen && (
        <div className="p-4 border-t border-slate-800/60 space-y-4">
          {/* Action Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-[#090d16] border border-slate-800/80 rounded-lg">
            <div>
              <p className="text-slate-300 font-medium text-xs">
                Deep semantic drift & latent dependency mining
              </p>
              <p className="text-[11px] text-slate-500">
                First run may take a few minutes while the model downloads.
              </p>
            </div>

            <button
              onClick={onTriggerInsights}
              disabled={!activeSha || isInsightsLoading}
              className="px-3.5 py-1.5 bg-cyan-950 hover:bg-cyan-900/80 disabled:opacity-50 text-cyan-300 border border-cyan-800 rounded-lg font-medium text-xs flex items-center space-x-1.5 transition-colors shrink-0"
            >
              {isInsightsLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Analyzing...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Run CodeBERT analysis for this commit</span>
                </>
              )}
            </button>
          </div>

          {/* Error Message */}
          {insightsError && (
            <div className="p-3 bg-rose-950/30 border border-rose-800/50 rounded-lg text-rose-300 text-xs flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{insightsError}</span>
            </div>
          )}

          {/* Results Display */}
          {insightsData && (
            <div className="space-y-4 pt-1">
              {/* One-line Info Tooltip */}
              <div className="flex items-center space-x-2 text-[11px] text-slate-400 bg-[#090d16] px-3 py-1.5 rounded-lg border border-slate-800">
                <Info className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>
                  Cosine similarity of CodeBERT embeddings after mean-centring — indicative, not proof of a dependency.
                </span>
              </div>

              {/* 1. File Semantic Drift */}
              {insightsData.drift && insightsData.drift.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] uppercase font-semibold tracking-wider text-slate-400">
                    File Semantic Drift ({insightsData.drift.length})
                  </div>
                  <div className="space-y-1.5">
                    {insightsData.drift.map((d, i) => {
                      const driftPct =
                        d.drift !== null ? Math.min(100, Math.round(d.drift * 100)) : 0;
                      return (
                        <div
                          key={i}
                          className="p-2.5 bg-[#090d16] border border-slate-800 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                        >
                          <div className="font-mono text-[11px] text-slate-300 truncate max-w-sm">
                            {d.file}
                          </div>
                          <div className="flex items-center space-x-3 shrink-0">
                            {d.drift !== null ? (
                              <div className="flex items-center space-x-2">
                                <div className="w-24 bg-slate-800 h-1.5 rounded-full overflow-hidden">
                                  <div
                                    className="bg-cyan-400 h-full rounded-full transition-all"
                                    style={{ width: `${driftPct}%` }}
                                  />
                                </div>
                                <span className="font-mono text-slate-300 text-[11px] w-12 text-right">
                                  {(d.drift * 100).toFixed(1)}%
                                </span>
                              </div>
                            ) : (
                              <span className="text-slate-500 text-[11px]">n/a</span>
                            )}
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-mono border uppercase tracking-wider ${levelColor(
                                d.level
                              )}`}
                            >
                              {d.level || 'n/a'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 2. Latent Dependencies */}
              {insightsData.latent_dependencies &&
                insightsData.latent_dependencies.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] uppercase font-semibold tracking-wider text-slate-400">
                      Discovered Latent Dependencies ({insightsData.latent_dependencies.length})
                    </div>
                    <div className="space-y-1.5">
                      {insightsData.latent_dependencies.map((ld) => {
                        const isAdded = addedLatentNodeIds.has(ld.id);
                        return (
                          <div
                            key={ld.id}
                            className="p-2.5 bg-[#090d16] border border-slate-800 rounded-lg flex items-center justify-between gap-2"
                          >
                            <div className="space-y-0.5 truncate">
                              <div className="font-mono text-[11px] text-slate-200 font-medium truncate">
                                {ld.label || ld.id}
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono truncate">
                                {ld.file} · {ld.node_type}
                              </div>
                            </div>

                            <div className="flex items-center space-x-2.5 shrink-0">
                              <div className="text-right">
                                <span className="font-mono text-cyan-300 text-[11px]">
                                  {(ld.score * 100).toFixed(0)}%
                                </span>
                                <span className="text-[10px] text-slate-500 block">
                                  {(ld.percentile * 100).toFixed(0)}th pct
                                </span>
                              </div>

                              <button
                                onClick={() => onToggleLatentNode(ld)}
                                className={`px-2 py-1 rounded text-[11px] border flex items-center space-x-1 transition-colors ${
                                  isAdded
                                    ? 'bg-violet-950 text-violet-300 border-violet-700'
                                    : 'bg-[#0f172a] hover:bg-slate-800 text-slate-300 border-slate-700'
                                }`}
                              >
                                {isAdded ? (
                                  <>
                                    <Check className="w-3 h-3 text-violet-400" />
                                    <span>Added</span>
                                  </>
                                ) : (
                                  <>
                                    <Plus className="w-3 h-3 text-cyan-400" />
                                    <span>Add to graph</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
