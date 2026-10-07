import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as d3 from 'd3';
import { api, type HotspotResult } from '../../api/client';
import { Flame, Loader2, AlertCircle, TrendingUp, Info, LayoutGrid, ListFilter } from 'lucide-react';

export const HotspotHeatmapView: React.FC = () => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [displayMode, setDisplayMode] = useState<'treemap' | 'list'>('treemap');

  const { data: hotspots, isLoading, isError, error } = useQuery<HotspotResult[]>({
    queryKey: ['hotspots'],
    queryFn: () => api.getHotspots(30),
  });

  const [hoveredModule, setHoveredModule] = useState<HotspotResult | null>(null);

  /**
   * D3 Render Function: Renders D3 Treemap Visualization
   */
  useEffect(() => {
    if (displayMode !== 'treemap' || !svgRef.current || !hotspots || hotspots.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = containerRef.current?.clientWidth || 900;
    const height = 440;

    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const hierarchyData = {
      name: 'root',
      children: hotspots.map((h) => ({
        name: h.module,
        value: h.semantic_churn_count,
      })),
    };

    const root = d3
      .hierarchy(hierarchyData)
      .sum((d: any) => d.value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    const treemap = d3.treemap().size([width, height]).paddingInner(4).paddingOuter(4);
    treemap(root as any);

    const maxChurn = d3.max(hotspots, (d) => d.semantic_churn_count) || 1;
    const colorScale = d3
      .scaleSequential()
      .domain([1, maxChurn])
      .interpolator(d3.interpolateRgb('#0e7490', '#f59e0b'));

    const leafNodes = root.leaves();

    const cellGroup = svg
      .selectAll('g')
      .data(leafNodes)
      .enter()
      .append('g')
      .attr('transform', (d: any) => `translate(${d.x0},${d.y0})`);

    cellGroup
      .append('rect')
      .attr('width', (d: any) => Math.max(0, d.x1 - d.x0))
      .attr('height', (d: any) => Math.max(0, d.y1 - d.y0))
      .attr('fill', (d: any) => colorScale(d.data.value))
      .attr('rx', 6)
      .attr('stroke', '#0f172a')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .style('transition', 'opacity 0.2s ease')
      .on('mouseover', (event, d: any) => {
        d3.select(event.currentTarget).attr('opacity', 0.85);
        setHoveredModule({
          module: d.data.name,
          semantic_churn_count: d.data.value,
        });
      })
      .on('mouseout', (event) => {
        d3.select(event.currentTarget).attr('opacity', 1.0);
        setHoveredModule(null);
      });

    cellGroup
      .append('text')
      .selectAll('tspan')
      .data((d: any) => {
        const cellWidth = d.x1 - d.x0;
        const cellHeight = d.y1 - d.y0;
        if (cellWidth < 50 || cellHeight < 30) return [];
        return [
          { text: d.data.name.split('/').pop() || d.data.name, isBold: true },
          { text: `${d.data.value} churn events`, isBold: false },
        ];
      })
      .enter()
      .append('tspan')
      .text((t) => t.text)
      .attr('x', 8)
      .attr('y', (_, i) => 18 + i * 16)
      .attr('fill', '#f8fafc')
      .attr('font-size', (t) => (t.isBold ? '11px' : '10px'))
      .attr('font-weight', (t) => (t.isBold ? '600' : '400'))
      .style('pointer-events', 'none');
  }, [hotspots, displayMode]);

  const totalChurn = hotspots ? hotspots.reduce((acc, h) => acc + h.semantic_churn_count, 0) : 0;
  const maxChurn = hotspots && hotspots.length > 0 ? hotspots[0].semantic_churn_count : 1;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#0f172a] p-5 border border-slate-800/80 rounded-xl">
        <div className="flex items-center space-x-3">
          <Flame className="w-5 h-5 text-amber-400" />
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
              Module Semantic Churn Hotspots
            </h2>
            <p className="text-xs text-slate-400">
              Modules ranked by logic_change and api_change event frequency
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Display Mode Toggle */}
          <div className="flex items-center bg-[#090d16] p-1 border border-slate-800 rounded-lg">
            <button
              onClick={() => setDisplayMode('treemap')}
              className={`px-3 py-1 text-xs font-medium rounded-md flex items-center space-x-1.5 transition-all ${
                displayMode === 'treemap'
                  ? 'bg-cyan-950 text-cyan-400 border border-cyan-500/50'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Treemap</span>
            </button>
            <button
              onClick={() => setDisplayMode('list')}
              className={`px-3 py-1 text-xs font-medium rounded-md flex items-center space-x-1.5 transition-all ${
                displayMode === 'list'
                  ? 'bg-cyan-950 text-cyan-400 border border-cyan-500/50'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ListFilter className="w-3.5 h-3.5" />
              <span>Ranked Matrix</span>
            </button>
          </div>

          {hotspots && hotspots.length > 0 && (
            <div className="hidden md:flex items-center space-x-2 text-xs text-slate-400 bg-[#090d16] px-3 py-1.5 rounded-lg border border-slate-800">
              <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
              <span>
                Top: <strong className="text-amber-300 font-mono">{hotspots[0].module}</strong>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Main Container */}
      <div
        ref={containerRef}
        className="relative bg-[#0f172a] border border-slate-800/80 rounded-xl p-6 min-h-[480px] flex flex-col justify-between"
      >
        {isLoading ? (
          <div className="h-[440px] flex flex-col items-center justify-center space-y-3 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
            <span className="text-xs">Computing treemap module heatmaps...</span>
          </div>
        ) : isError ? (
          <div className="h-[440px] flex flex-col items-center justify-center text-rose-400 space-y-2">
            <AlertCircle className="w-6 h-6" />
            <span className="text-xs">{(error as any)?.message || 'Failed to load hotspots'}</span>
          </div>
        ) : !hotspots || hotspots.length === 0 ? (
          <div className="h-[440px] flex flex-col items-center justify-center text-slate-500 text-xs">
            No semantic hotspots recorded yet. Run analysis on a repository to detect churn hotspots.
          </div>
        ) : displayMode === 'treemap' ? (
          <div className="w-full">
            <svg ref={svgRef} className="w-full h-[440px]" />
          </div>
        ) : (
          /* Ranked Matrix List View */
          <div className="w-full space-y-3 max-h-[440px] overflow-y-auto pr-2">
            {hotspots.map((item, rank) => {
              const pct = maxChurn > 0 ? Math.round((item.semantic_churn_count / maxChurn) * 100) : 0;
              return (
                <div
                  key={item.module}
                  className="bg-[#090d16] border border-slate-800/80 p-3.5 rounded-lg flex items-center justify-between hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-center space-x-3.5 min-w-0 flex-1 pr-4">
                    <span className="w-6 h-6 rounded-full bg-slate-800 text-slate-400 text-xs font-bold flex items-center justify-center shrink-0">
                      #{rank + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-mono text-slate-200 truncate font-semibold">
                        {item.module}
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
                        <div
                          className="bg-amber-400 h-1.5 rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-sm font-bold text-amber-400">{item.semantic_churn_count}</span>
                    <span className="text-[10px] text-slate-500 block">churn events</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer info */}
        <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs">
          {hoveredModule ? (
            <div className="flex items-center space-x-2 text-slate-200">
              <Info className="w-4 h-4 text-amber-400" />
              <span>
                Inspecting Module: <strong className="font-mono text-cyan-300">{hoveredModule.module}</strong>
              </span>
              <span>
                — <strong className="text-amber-400">{hoveredModule.semantic_churn_count}</strong> churn events
              </span>
            </div>
          ) : (
            <div className="text-slate-500 text-[11px]">
              Total semantic churn across modules: <strong className="text-slate-300">{totalChurn} events</strong>. Hover or click to inspect metrics.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
