import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRepoContext } from '../../context/RepoContext';
import { api, type JobStatusResult } from '../../api/client';

import { GitBranch, Play, CheckCircle2, AlertCircle, Loader2, ArrowRight } from 'lucide-react';

export const RepoInputView: React.FC = () => {
  const { jobId, setJobId, repoUrlOrPath, setRepoUrlOrPath, setActiveView, setSelectedCommitSha } = useRepoContext();
  const queryClient = useQueryClient();

  const [depth, setDepth] = useState<number>(100);
  const [hopLimit, setHopLimit] = useState<number>(3);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [jobStatus, setJobStatus] = useState<JobStatusResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Poll job status every 2 seconds when jobId exists and is running/pending
  useEffect(() => {
    if (!jobId) return;

    let isSubscribed = true;
    const fetchStatus = async () => {
      try {
        const res = await api.getJobStatus(jobId);
        if (isSubscribed) {
          setJobStatus(res);
          if (res.status === 'complete') {
            // Automatically switch to timeline view when analysis completes
            setTimeout(() => {
              if (isSubscribed) setActiveView('timeline');
            }, 1000);
          } else if (res.status === 'failed') {
            setErrorMsg(res.error || 'Repository analysis failed');
          }
        }
      } catch (err: any) {
        if (isSubscribed) {
          setErrorMsg(err.message || 'Failed to check job status');
        }
      }
    };

    fetchStatus();
    const interval = setInterval(() => {
      if (jobStatus?.status !== 'complete' && jobStatus?.status !== 'failed') {
        fetchStatus();
      }
    }, 2000);

    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [jobId, jobStatus?.status, setActiveView]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrlOrPath.trim()) return;

    setSubmitting(true);
    setErrorMsg(null);
    setJobStatus(null);

    try {
      // Reset frontend state for new repo analysis
      setSelectedCommitSha(null);
      queryClient.invalidateQueries({ queryKey: ['commits'] });
      queryClient.invalidateQueries({ queryKey: ['hotspots'] });
      queryClient.invalidateQueries({ queryKey: ['impact'] });

      const res = await api.analyzeRepo({
        repo_url_or_path: repoUrlOrPath.trim(),
        commit_depth: depth,
        hop_limit: hopLimit,
      });
      setJobId(res.job_id);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to start analysis');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-12 px-6">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-100 mb-3">
          Semantic Software Evolution Analysis
        </h1>
        <p className="text-slate-400 text-sm max-w-xl mx-auto leading-relaxed">
          Analyze git repository commit history, GumTree AST structural diffs, NetworkX dependency impact graphs, and LLM-synthesized evolution risk metrics.
        </p>
      </div>

      <div className="bg-[#0f172a] border border-slate-800/80 rounded-xl p-8 shadow-2xl backdrop-blur-sm">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Repository URL or Local Path
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <GitBranch className="w-4 h-4" />
              </span>
              <input
                type="text"
                value={repoUrlOrPath}
                onChange={(e) => setRepoUrlOrPath(e.target.value)}
                placeholder="e.g. ./ or https://github.com/org/repo.git"
                className="w-full pl-10 pr-4 py-3 bg-[#090d16] border border-slate-800 rounded-lg text-slate-200 text-sm focus:outline-none focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/50 transition-colors"
                required
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Provide an absolute path, relative local directory (e.g. <code className="text-cyan-400">./</code>), or remote Git clone URL.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Commit Depth */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Commit Depth (1 - 1000)
                </label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={depth}
                  onChange={(e) => setDepth(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
                  className="w-20 px-2.5 py-1 bg-[#090d16] border border-slate-800 rounded text-right text-xs font-mono text-cyan-400 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[10, 25, 50, 100].map((d) => (
                  <button
                    type="button"
                    key={d}
                    onClick={() => setDepth(d)}
                    className={`py-2 px-2 text-xs font-medium rounded-lg border transition-all ${
                      depth === d
                        ? 'bg-cyan-950/60 border-cyan-500/80 text-cyan-400 shadow-sm'
                        : 'bg-[#090d16] border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* Hop Limit */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Impact Hop Limit (1 - 10)
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={hopLimit}
                  onChange={(e) => setHopLimit(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                  className="w-20 px-2.5 py-1 bg-[#090d16] border border-slate-800 rounded text-right text-xs font-mono text-cyan-400 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 5].map((h) => (
                  <button
                    type="button"
                    key={h}
                    onClick={() => setHopLimit(h)}
                    className={`py-2 px-2 text-xs font-medium rounded-lg border transition-all ${
                      hopLimit === h
                        ? 'bg-cyan-950/60 border-cyan-500/80 text-cyan-400 shadow-sm'
                        : 'bg-[#090d16] border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    {h} {h === 1 ? 'Hop' : 'Hops'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || (jobStatus?.status === 'running' || jobStatus?.status === 'pending')}
            className="w-full py-3 px-6 bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-sm rounded-lg flex items-center justify-center space-x-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-cyan-950/50"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Initiating Pipeline...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>Start Visual Analytics Pipeline</span>
              </>
            )}
          </button>
        </form>

        {/* Real-time Job Status Indicator */}
        {jobStatus && (
          <div className="mt-8 pt-6 border-t border-slate-800/80">
            <div className="flex items-center justify-between p-4 bg-[#090d16] border border-slate-800 rounded-lg">
              <div className="flex items-center space-x-3">
                {jobStatus.status === 'pending' && (
                  <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
                )}
                {jobStatus.status === 'running' && (
                  <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
                )}
                {jobStatus.status === 'complete' && (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                )}
                {jobStatus.status === 'failed' && (
                  <AlertCircle className="w-5 h-5 text-rose-400" />
                )}

                <div>
                  <div className="text-xs uppercase tracking-wider font-semibold text-slate-400">
                    Pipeline Execution Status
                  </div>
                  <div className="text-sm font-medium text-slate-200 capitalize">
                    {jobStatus.status}
                    {jobStatus.status === 'running' && ' — Extracting AST diffs & impact graph...'}
                    {jobStatus.status === 'complete' && ' — Ready for visual analytics!'}
                  </div>
                </div>
              </div>

              {jobStatus.status === 'complete' && (
                <button
                  onClick={() => setActiveView('timeline')}
                  className="py-2 px-4 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/40 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors"
                >
                  <span>Explore Timeline</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Error Alert */}
        {errorMsg && (
          <div className="mt-6 p-4 bg-rose-950/40 border border-rose-800/60 rounded-lg flex items-start space-x-3 text-rose-300 text-xs">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block mb-0.5">Analysis Failure:</span>
              <span>{errorMsg}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
