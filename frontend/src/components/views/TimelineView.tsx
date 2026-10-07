import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as d3 from 'd3';
import { api, type ExplanationResult } from '../../api/client';
import { useRepoContext } from '../../context/RepoContext';
import { RiskSummaryHeader } from '../analytics/RiskSummaryHeader';
import { Filter, Calendar, User, Tag, ArrowRight, ShieldAlert, Loader2, AlertCircle, Sparkles } from 'lucide-react';


// Fixed color palette per change_type
export const CHANGE_TYPE_COLORS: Record<string, string> = {
  logic_change: '#10b981',      // Emerald
  api_change: '#f59e0b',        // Amber
  refactor: '#8b5cf6',          // Violet
  bug_fix_pattern: '#06b6d4',   // Cyan
  'formatting/cosmetic': '#64748b', // Slate
  rename: '#ec4899',            // Pink
  unknown: '#71717a',           // Zinc
};

export const TimelineView: React.FC = () => {
  const { selectedCommitSha, setSelectedCommitSha, setActiveView } = useRepoContext();
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Filters state
  const [selectedAuthor, setSelectedAuthor] = useState<string>('all');
  const [selectedChangeType, setSelectedChangeType] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Fetch commits
  const { data: commits, isLoading, isError, error } = useQuery({
    queryKey: ['commits'],
    queryFn: () => api.getCommits(200, 0),
  });

  // Fetch hotspots for top header stats
  const { data: hotspots } = useQuery({
    queryKey: ['hotspots'],
    queryFn: () => api.getHotspots(10),
  });

  const [selectedExpFileIndex, setSelectedExpFileIndex] = useState<number>(0);

  // Fetch explanation for selected commit
  const { data: rawExplanation, isLoading: expLoading } = useQuery<ExplanationResult | ExplanationResult[]>({
    queryKey: ['explanation', selectedCommitSha],
    queryFn: () => api.getCommitExplanation(selectedCommitSha!),
    enabled: !!selectedCommitSha,
  });

  const explanationList: ExplanationResult[] = useMemo(() => {
    if (!rawExplanation) return [];
    return Array.isArray(rawExplanation) ? rawExplanation : [rawExplanation];
  }, [rawExplanation]);

  useEffect(() => {
    setSelectedExpFileIndex(0);
  }, [selectedCommitSha]);

  const explanation: ExplanationResult | null =
    explanationList[selectedExpFileIndex] || explanationList[0] || null;

  const authors = useMemo(() => {
    if (!commits) return [];
    return Array.from(new Set(commits.map((c) => c.author)));
  }, [commits]);

  const changeTypes = useMemo(() => {
    if (!commits) return [];
    return Array.from(new Set(commits.map((c) => c.change_type)));
  }, [commits]);

  const filteredCommits = useMemo(() => {
    if (!commits) return [];
    return commits.filter((c) => {
      const matchAuthor = selectedAuthor === 'all' || c.author === selectedAuthor;
      const matchType = selectedChangeType === 'all' || c.change_type === selectedChangeType;
      const matchSearch =
        !searchTerm.trim() ||
        c.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.sha.toLowerCase().includes(searchTerm.toLowerCase());
      return matchAuthor && matchType && matchSearch;
    });
  }, [commits, selectedAuthor, selectedChangeType, searchTerm]);

  /**
   * D3 Render Function: Renders main timeline timeline with D3 scaleTime, zoom, and dots
   */
  useEffect(() => {
    if (!svgRef.current || !filteredCommits || filteredCommits.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth || 900;
    const height = 260;
    const margin = { top: 30, right: 40, bottom: 50, left: 40 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const parsedData = filteredCommits.map((c) => ({
      ...c,
      date: new Date(c.timestamp),
    }));

    const dates = parsedData.map((d) => d.date);
    const minDate = d3.min(dates) || new Date();
    const maxDate = d3.max(dates) || new Date();

    const startDate = new Date(minDate.getTime() - 3600 * 1000 * 24);
    const endDate = new Date(maxDate.getTime() + 3600 * 1000 * 24);

    const xScale = d3.scaleTime().domain([startDate, endDate]).range([0, innerWidth]);

    const xAxis = d3
      .axisBottom(xScale)
      .ticks(6)
      .tickFormat(d3.timeFormat('%b %d, %H:%M') as any)
      .tickSize(-innerHeight);

    const axisG = g.append('g').attr('transform', `translate(0,${innerHeight})`).call(xAxis);

    axisG.select('.domain').attr('stroke', '#334155');
    axisG.selectAll('.tick line').attr('stroke', '#1e293b').attr('stroke-dasharray', '3,3');
    axisG.selectAll('.tick text').attr('fill', '#94a3b8').attr('font-size', '11px').attr('dy', '14px');

    g.append('line')
      .attr('x1', 0)
      .attr('y1', innerHeight / 2)
      .attr('x2', innerWidth)
      .attr('y2', innerHeight / 2)
      .attr('stroke', '#334155')
      .attr('stroke-width', 2);

    const tooltip = d3
      .select('body')
      .selectAll<HTMLDivElement, unknown>('.timeline-tooltip')
      .data([null])
      .join('div')
      .attr('class', 'timeline-tooltip')
      .style('position', 'absolute')
      .style('visibility', 'hidden')
      .style('background-color', '#0f172a')
      .style('border', '1px solid #334155')
      .style('border-radius', '8px')
      .style('padding', '8px 12px')
      .style('color', '#f8fafc')
      .style('font-size', '12px')
      .style('box-shadow', '0 10px 25px -5px rgba(0, 0, 0, 0.5)')
      .style('pointer-events', 'none')
      .style('z-index', '100');

    g.selectAll('.commit-dot')
      .data(parsedData)
      .enter()
      .append('circle')
      .attr('class', 'commit-dot')
      .attr('cx', (d) => xScale(d.date))
      .attr('cy', innerHeight / 2)
      .attr('r', (d) => (d.sha === selectedCommitSha ? 10 : 7))
      .attr('fill', (d) => CHANGE_TYPE_COLORS[d.change_type] || '#71717a')
      .attr('stroke', (d) => (d.sha === selectedCommitSha ? '#38bdf8' : '#0f172a'))
      .attr('stroke-width', (d) => (d.sha === selectedCommitSha ? 3 : 1.5))
      .style('cursor', 'pointer')
      .style('transition', 'all 0.2s ease')
      .on('mouseover', (event, d) => {
        tooltip
          .style('visibility', 'visible')
          .html(
            `<div class="font-mono text-cyan-400 text-[11px] mb-1">${d.sha.substring(0, 8)}</div>` +
              `<div class="font-medium text-slate-200 mb-1">${d.message}</div>` +
              `<div class="text-slate-400 text-[10px]">${d.author} • ${d.change_type}</div>`
          );
        d3.select(event.currentTarget).attr('r', 11);
      })
      .on('mousemove', (event) => {
        tooltip.style('top', `${event.pageY - 70}px`).style('left', `${event.pageX + 15}px`);
      })
      .on('mouseout', (event, d) => {
        tooltip.style('visibility', 'hidden');
        d3.select(event.currentTarget).attr('r', d.sha === selectedCommitSha ? 10 : 7);
      })
      .on('click', (_, d) => {
        setSelectedCommitSha(d.sha);
      });
  }, [filteredCommits, selectedCommitSha, setSelectedCommitSha]);

  return (
    <div className="space-y-6">
      {/* Top Risk & Churn Summary Dashboard Header */}
      {commits && <RiskSummaryHeader commits={commits} hotspots={hotspots} />}

      {/* Filter Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0f172a] p-5 border border-slate-800/80 rounded-xl">
        <div className="flex items-center space-x-3">
          <Filter className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
            Timeline Filters
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <User className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
            <select
              value={selectedAuthor}
              onChange={(e) => setSelectedAuthor(e.target.value)}
              className="pl-8 pr-8 py-1.5 bg-[#090d16] border border-slate-800 text-slate-300 text-xs rounded-lg focus:outline-none focus:border-cyan-500"
            >
              <option value="all">All Authors ({authors.length})</option>
              {authors.map((auth) => (
                <option key={auth} value={auth}>
                  {auth}
                </option>
              ))}
            </select>
          </div>

          <div className="relative">
            <Tag className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
            <select
              value={selectedChangeType}
              onChange={(e) => setSelectedChangeType(e.target.value)}
              className="pl-8 pr-8 py-1.5 bg-[#090d16] border border-slate-800 text-slate-300 text-xs rounded-lg focus:outline-none focus:border-cyan-500"
            >
              <option value="all">All Change Types</option>
              {changeTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <input
            type="text"
            placeholder="Search commit message/SHA..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-3 py-1.5 bg-[#090d16] border border-slate-800 text-slate-300 text-xs rounded-lg focus:outline-none focus:border-cyan-500 w-48"
          />
        </div>
      </div>

      {/* Main Layout: Timeline Visualization + Commit Detail Side Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#0f172a] border border-slate-800/80 rounded-xl p-6 flex flex-col justify-between min-h-[420px]">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-100">Commit Evolution History</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Showing {filteredCommits.length} commits positioned chronologically
                </p>
              </div>
            </div>

            {isLoading ? (
              <div className="h-64 flex flex-col items-center justify-center space-y-3 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                <span className="text-xs">Loading repository commits...</span>
              </div>
            ) : isError ? (
              <div className="h-64 flex flex-col items-center justify-center text-rose-400 space-y-2">
                <AlertCircle className="w-6 h-6" />
                <span className="text-xs">{(error as any)?.message || 'Failed to fetch commits'}</span>
              </div>
            ) : filteredCommits.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-slate-500 text-xs">
                No commits match the selected filters.
              </div>
            ) : (
              <div className="relative w-full">
                <svg ref={svgRef} className="w-full h-[260px]" />
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-800/80 flex flex-wrap items-center gap-4 text-xs">
            <span className="text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
              Legend:
            </span>
            {Object.entries(CHANGE_TYPE_COLORS).map(([type, color]) => (
              <div key={type} className="flex items-center space-x-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-slate-400 capitalize">{type.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Side Panel: Explanation */}
        <div className="bg-[#0f172a] border border-slate-800/80 rounded-xl p-6 flex flex-col">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-4 flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span>AI Semantic Explanation</span>
          </h3>

          {!selectedCommitSha ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-500 text-xs border border-dashed border-slate-800 rounded-lg">
              <Calendar className="w-8 h-8 text-slate-600 mb-2 stroke-[1.5]" />
              <span>Select any commit dot on the timeline to inspect its AI explanation and risk breakdown.</span>
            </div>
          ) : expLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center space-y-3 text-slate-400 py-12">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
              <span className="text-xs">Fetching LLM explanation...</span>
            </div>
          ) : explanation ? (
            <div className="space-y-5 flex-1 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-cyan-400 bg-cyan-950/60 border border-cyan-500/30 px-2.5 py-1 rounded">
                    SHA: {selectedCommitSha.substring(0, 8)}
                  </span>

                  <div
                    className={`flex items-center space-x-1.5 px-2.5 py-1 rounded text-xs font-semibold uppercase tracking-wider border ${
                      explanation.risk_level === 'critical'
                        ? 'bg-rose-950/80 border-rose-500/80 text-rose-300'
                        : explanation.risk_level === 'high'
                        ? 'bg-amber-950/80 border-amber-500/80 text-amber-300'
                        : explanation.risk_level === 'medium'
                        ? 'bg-yellow-950/60 border-yellow-500/60 text-yellow-300'
                        : 'bg-emerald-950/60 border-emerald-500/60 text-emerald-300'
                    }`}
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>{explanation.risk_level} Risk</span>
                  </div>
                </div>

                {/* Multi-file Explanation Tabs */}
                {explanationList.length > 1 && (
                  <div>
                    <div className="text-[10px] uppercase font-semibold text-slate-500 mb-1.5">
                      Changed Files ({explanationList.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {explanationList.map((exp, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedExpFileIndex(idx)}
                          className={`px-2 py-1 text-[11px] font-mono rounded transition-colors ${
                            selectedExpFileIndex === idx
                              ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/60 font-semibold'
                              : 'bg-[#090d16] text-slate-400 border border-slate-800 hover:text-slate-200'
                          }`}
                        >
                          {exp.file_path || `File #${idx + 1}`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div className="text-[11px] font-semibold uppercase text-slate-500 mb-1">
                    Evolution Summary
                  </div>
                  <p className="text-xs text-slate-200 leading-relaxed bg-[#090d16] p-3 rounded-lg border border-slate-800/80">
                    {explanation.summary}
                  </p>
                </div>

                <div>
                  <div className="text-[11px] font-semibold uppercase text-slate-500 mb-1">
                    Why It Matters
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed bg-[#090d16] p-3 rounded-lg border border-slate-800/80">
                    {explanation.why_it_matters}
                  </p>
                </div>

                <div className="flex items-center justify-between text-xs p-3 bg-[#090d16] border border-slate-800 rounded-lg">
                  <span className="text-slate-400">Total Graph Impacted Nodes:</span>
                  <span className="font-semibold text-cyan-400">{explanation.affected_count}</span>
                </div>
              </div>

              <button
                onClick={() => setActiveView('graph')}
                className="w-full mt-4 py-2.5 px-4 bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs rounded-lg flex items-center justify-center space-x-2 transition-colors shadow-md"
              >
                <span>View Dependency Impact Graph</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="text-xs text-slate-500 text-center py-8">
              No explanation stored for this commit.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
