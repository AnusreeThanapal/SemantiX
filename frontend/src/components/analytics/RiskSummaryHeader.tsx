import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { CommitSummary, HotspotResult } from '../../api/client';
import { ShieldAlert, Flame, GitCommit } from 'lucide-react';


interface RiskSummaryHeaderProps {
  commits: CommitSummary[];
  hotspots?: HotspotResult[];
}

export const RiskSummaryHeader: React.FC<RiskSummaryHeaderProps> = ({ commits, hotspots }) => {
  const donutRef = useRef<SVGSVGElement | null>(null);

  // Compute stats
  const totalCommits = commits.length;
  const criticalCount = commits.filter((c) => c.risk_level === 'critical').length;
  const highCount = commits.filter((c) => c.risk_level === 'high').length;
  const mediumCount = commits.filter((c) => c.risk_level === 'medium').length;
  const lowCount = commits.filter((c) => c.risk_level === 'low').length;

  const highRiskRatio = totalCommits > 0 ? Math.round(((criticalCount + highCount) / totalCommits) * 100) : 0;
  const topHotspot = hotspots && hotspots.length > 0 ? hotspots[0] : null;

  /**
   * D3 Render Function: Renders Donut Chart for Risk Distribution
   */
  useEffect(() => {
    if (!donutRef.current || totalCommits === 0) return;

    const svg = d3.select(donutRef.current);
    svg.selectAll('*').remove();

    const width = 120;
    const height = 120;
    const radius = Math.min(width, height) / 2;

    const g = svg
      .append('g')
      .attr('transform', `translate(${width / 2},${height / 2})`);

    const data = [
      { level: 'critical', count: criticalCount, color: '#f43f5e' },
      { level: 'high', count: highCount, color: '#f59e0b' },
      { level: 'medium', count: mediumCount, color: '#eab308' },
      { level: 'low', count: lowCount, color: '#10b981' },
    ].filter((d) => d.count > 0);

    const pie = d3
      .pie<{ level: string; count: number; color: string }>()
      .value((d) => d.count)
      .sort(null);

    const arc = d3
      .arc<d3.PieArcDatum<{ level: string; count: number; color: string }>>()
      .innerRadius(radius * 0.55)
      .outerRadius(radius * 0.95);

    g.selectAll('path')
      .data(pie(data))
      .enter()
      .append('path')
      .attr('d', arc as any)
      .attr('fill', (d) => d.data.color)
      .attr('stroke', '#0f172a')
      .attr('stroke-width', 2)
      .style('transition', 'transform 0.2s ease')
      .on('mouseover', function () {
        d3.select(this).attr('transform', 'scale(1.05)');
      })
      .on('mouseout', function () {
        d3.select(this).attr('transform', 'scale(1)');
      });

    // Center Label
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '4px')
      .attr('fill', '#f1f5f9')
      .attr('font-size', '16px')
      .attr('font-weight', '700')
      .text(`${highRiskRatio}%`);

    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '18px')
      .attr('fill', '#94a3b8')
      .attr('font-size', '8px')
      .text('High/Crit Risk');
  }, [totalCommits, criticalCount, highCount, mediumCount, lowCount, highRiskRatio]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      {/* Card 1: Total Analyzed Commits */}
      <div className="bg-[#0f172a] border border-slate-800/80 rounded-xl p-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            Analyzed Commits
          </div>
          <div className="text-2xl font-bold text-slate-100">{totalCommits}</div>
          <div className="text-[11px] text-slate-400 mt-1">Walked history window</div>
        </div>
        <div className="w-10 h-10 rounded-lg bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
          <GitCommit className="w-5 h-5" />
        </div>
      </div>

      {/* Card 2: High & Critical Risk Ratio */}
      <div className="bg-[#0f172a] border border-slate-800/80 rounded-xl p-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            High Risk Exposure
          </div>
          <div className="text-2xl font-bold text-amber-400">{highRiskRatio}%</div>
          <div className="text-[11px] text-slate-400 mt-1">
            {criticalCount + highCount} high-impact commits
          </div>
        </div>
        <div className="w-10 h-10 rounded-lg bg-amber-950/80 border border-amber-500/40 flex items-center justify-center text-amber-400">
          <ShieldAlert className="w-5 h-5" />
        </div>
      </div>

      {/* Card 3: Top Hotspot Module */}
      <div className="bg-[#0f172a] border border-slate-800/80 rounded-xl p-4 flex items-center justify-between">
        <div className="min-w-0 flex-1 pr-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            Top Churn Hotspot
          </div>
          <div className="text-sm font-bold text-slate-100 truncate font-mono">
            {topHotspot ? topHotspot.module : 'N/A'}
          </div>
          <div className="text-[11px] text-amber-400 mt-1 font-medium">
            {topHotspot ? `${topHotspot.semantic_churn_count} churn events` : 'No hotspots'}
          </div>
        </div>
        <div className="w-10 h-10 rounded-lg bg-rose-950/80 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0">
          <Flame className="w-5 h-5" />
        </div>
      </div>

      {/* Card 4: D3 Donut Chart */}
      <div className="bg-[#0f172a] border border-slate-800/80 rounded-xl p-3 flex items-center justify-between">
        <div className="flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            Risk Distribution
          </div>
          <div className="space-y-1 text-[11px]">
            <div className="flex items-center justify-between text-rose-400">
              <span>Critical:</span> <span className="font-semibold">{criticalCount}</span>
            </div>
            <div className="flex items-center justify-between text-amber-400">
              <span>High:</span> <span className="font-semibold">{highCount}</span>
            </div>
            <div className="flex items-center justify-between text-emerald-400">
              <span>Low/Med:</span> <span className="font-semibold">{lowCount + mediumCount}</span>
            </div>
          </div>
        </div>
        <svg ref={donutRef} className="w-[120px] h-[120px] shrink-0" />
      </div>
    </div>
  );
};
