import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as d3 from 'd3';
import { api, type ImpactSubgraphResult } from '../../api/client';
import { useRepoContext } from '../../context/RepoContext';
import { Network, RotateCcw, Loader2, AlertCircle, Info, Grid, Search } from 'lucide-react';

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  type: 'changed' | 'direct' | 'transitive';
  impactDistance: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

export const DependencyGraphView: React.FC = () => {
  const { selectedCommitSha, setSelectedCommitSha } = useRepoContext();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const matrixSvgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [viewMode, setViewMode] = useState<'orbit' | 'matrix'>('orbit');
  const [nodeSearch, setNodeSearch] = useState<string>('');
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);

  const { data: commits } = useQuery({
    queryKey: ['commits'],
    queryFn: () => api.getCommits(50, 0),
    enabled: !selectedCommitSha,
  });

  const activeSha = selectedCommitSha || (commits && commits.length > 0 ? commits[0].sha : null);

  const { data: rawImpact, isLoading, isError, error } = useQuery<ImpactSubgraphResult | ImpactSubgraphResult[]>({
    queryKey: ['impact', activeSha],
    queryFn: () => api.getCommitImpact(activeSha!),
    enabled: !!activeSha,
  });

  const impactList: ImpactSubgraphResult[] = useMemo(() => {
    if (!rawImpact) return [];
    return Array.isArray(rawImpact) ? rawImpact : [rawImpact];
  }, [rawImpact]);

  // Reset file index on SHA change
  useEffect(() => {
    setSelectedFileIndex(0);
  }, [activeSha]);

  const impact: ImpactSubgraphResult | null = impactList[selectedFileIndex] || impactList[0] || null;

  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);

  /**
   * D3 Force Orbit Render Function
   */
  useEffect(() => {
    if (viewMode !== 'orbit' || !svgRef.current || !impact) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = containerRef.current?.clientWidth || 800;
    const height = 500;

    const nodes: GraphNode[] = [];
    nodes.push({
      id: impact.changed_node,
      name: impact.changed_node,
      type: 'changed',
      impactDistance: 0,
    });

    impact.direct_impacts.forEach((name) => {
      nodes.push({
        id: name,
        name: name,
        type: 'direct',
        impactDistance: 1,
      });
    });

    impact.transitive_impacts.forEach((name) => {
      nodes.push({
        id: name,
        name: name,
        type: 'transitive',
        impactDistance: 2,
      });
    });

    const links: GraphLink[] = [];
    impact.direct_impacts.forEach((directName) => {
      links.push({ source: impact.changed_node, target: directName });
      impact.transitive_impacts.forEach((transName) => {
        links.push({ source: directName, target: transName });
      });
    });

    const g = svg.append('g').attr('class', 'main-group');

    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 5])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoomBehavior as any);

    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        d3.forceLink<GraphNode, GraphLink>(links).id((d) => d.id).distance((d) => {
          const source = d.source as GraphNode;
          return source.type === 'changed' ? 120 : 80;
        })
      )
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force(
        'radial',
        d3.forceRadial<GraphNode>((d) => d.impactDistance * 130, width / 2, height / 2).strength(0.8)
      )
      .force('collide', d3.forceCollide().radius(35));

    const linkGroup = g
      .append('g')
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke', '#334155')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', (d) => {
        const target = d.target as GraphNode;
        return target.type === 'transitive' ? '4,4' : 'none';
      });

    const nodeGroup = g
      .append('g')
      .selectAll('.node')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'node')
      .style('cursor', 'pointer')
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    nodeGroup
      .append('circle')
      .attr('r', (d) => (d.type === 'changed' ? 18 : d.type === 'direct' ? 13 : 9))
      .attr('fill', (d) => {
        const isMatch = nodeSearch.trim() && d.name.toLowerCase().includes(nodeSearch.toLowerCase());
        if (isMatch) return '#38bdf8';
        return d.type === 'changed' ? '#38bdf8' : d.type === 'direct' ? '#f59e0b' : '#8b5cf6';
      })
      .attr('stroke', (d) => (d.type === 'changed' ? '#7dd3fc' : d.type === 'direct' ? '#fde68a' : '#c084fc'))
      .attr('stroke-width', (d) => (d.type === 'changed' ? 3 : 1.5))
      .style('filter', (d) => (d.type === 'changed' ? 'drop-shadow(0 0 10px rgba(56, 189, 248, 0.6))' : 'none'));

    nodeGroup
      .append('text')
      .text((d) => {
        const parts = d.name.split(':');
        const leafName = parts[parts.length - 1];
        return leafName.length > 18 ? leafName.substring(0, 16) + '...' : leafName;
      })
      .attr('x', 0)
      .attr('y', (d) => (d.type === 'changed' ? 30 : 22))
      .attr('text-anchor', 'middle')
      .attr('fill', (d) => {
        const isMatch = nodeSearch.trim() && d.name.toLowerCase().includes(nodeSearch.toLowerCase());
        return isMatch ? '#38bdf8' : '#94a3b8';
      })
      .attr('font-size', '10px')
      .attr('font-weight', (d) => (d.type === 'changed' ? '600' : '400'));

    nodeGroup
      .on('mouseover', (_, d) => setHoveredNode(d))
      .on('mouseout', () => setHoveredNode(null))
      .on('click', (event, d) => {
        event.stopPropagation();
        if (d.x !== undefined && d.y !== undefined) {
          const transform = d3.zoomIdentity.translate(width / 2 - d.x * 1.5, height / 2 - d.y * 1.5).scale(1.5);
          svg.transition().duration(750).call(zoomBehavior.transform as any, transform);
        }
      });

    simulation.on('tick', () => {
      linkGroup
        .attr('x1', (d) => (d.source as GraphNode).x || 0)
        .attr('y1', (d) => (d.source as GraphNode).y || 0)
        .attr('x2', (d) => (d.target as GraphNode).x || 0)
        .attr('y2', (d) => (d.target as GraphNode).y || 0);

      nodeGroup.attr('transform', (d) => `translate(${d.x || 0},${d.y || 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [impact, viewMode, nodeSearch]);

  /**
   * D3 Impact Matrix Heat-Grid Render Function
   */
  useEffect(() => {
    if (viewMode !== 'matrix' || !matrixSvgRef.current || !impact) return;

    const svg = d3.select(matrixSvgRef.current);
    svg.selectAll('*').remove();

    const width = containerRef.current?.clientWidth || 800;
    const targets = [...impact.direct_impacts, ...impact.transitive_impacts];
    const rowHeight = 36;
    const height = Math.max(300, targets.length * rowHeight + 80);

    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const g = svg.append('g').attr('transform', 'translate(180, 40)');

    // Render Matrix Rows
    targets.forEach((targetName, idx) => {
      const isDirect = impact.direct_impacts.includes(targetName);
      const rowY = idx * rowHeight;

      // Row background
      g.append('rect')
        .attr('x', 0)
        .attr('y', rowY)
        .attr('width', width - 220)
        .attr('height', rowHeight - 6)
        .attr('fill', '#090d16')
        .attr('rx', 6)
        .attr('stroke', '#1e293b');

      // Target Label
      g.append('text')
        .text(targetName)
        .attr('x', -10)
        .attr('y', rowY + 18)
        .attr('text-anchor', 'end')
        .attr('fill', isDirect ? '#f59e0b' : '#c084fc')
        .attr('font-size', '11px')
        .attr('font-family', 'monospace');

      // Heat Circle
      g.append('circle')
        .attr('cx', 40)
        .attr('cy', rowY + 15)
        .attr('r', isDirect ? 10 : 7)
        .attr('fill', isDirect ? '#f59e0b' : '#8b5cf6')
        .attr('opacity', isDirect ? 0.9 : 0.6);

      // Impact Status Text
      g.append('text')
        .text(isDirect ? 'Direct 1-Hop Impact' : 'Transitive 2+ Hop Impact')
        .attr('x', 70)
        .attr('y', rowY + 19)
        .attr('fill', '#94a3b8')
        .attr('font-size', '11px');
    });
  }, [impact, viewMode]);

  const handleResetZoom = () => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.transition().duration(500).call(d3.zoom().transform as any, d3.zoomIdentity);
  };

  return (
    <div className="space-y-6">
      {/* Top Bar: Selector & View Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#0f172a] p-5 border border-slate-800/80 rounded-xl">
        <div className="flex items-center space-x-3">
          <Network className="w-5 h-5 text-cyan-400" />
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
              Dependency Impact Propagation Graph
            </h2>
            <p className="text-xs text-slate-400">
              Static symbol reachability analysis up to 3 hops
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* View Toggle */}
          <div className="flex items-center bg-[#090d16] p-1 border border-slate-800 rounded-lg">
            <button
              onClick={() => setViewMode('orbit')}
              className={`px-3 py-1 text-xs font-medium rounded-md flex items-center space-x-1.5 transition-all ${
                viewMode === 'orbit'
                  ? 'bg-cyan-950 text-cyan-400 border border-cyan-500/50'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              <span>Orbit View</span>
            </button>
            <button
              onClick={() => setViewMode('matrix')}
              className={`px-3 py-1 text-xs font-medium rounded-md flex items-center space-x-1.5 transition-all ${
                viewMode === 'matrix'
                  ? 'bg-cyan-950 text-cyan-400 border border-cyan-500/50'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
              <span>Matrix Grid</span>
            </button>
          </div>

          {/* Node Search Bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search symbol..."
              value={nodeSearch}
              onChange={(e) => setNodeSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-[#090d16] border border-slate-800 text-slate-200 text-xs rounded-lg focus:outline-none focus:border-cyan-500 w-40"
            />
          </div>

          {/* Commit Picker */}
          {commits && commits.length > 0 && (
            <select
              value={activeSha || ''}
              onChange={(e) => setSelectedCommitSha(e.target.value)}
              className="px-3 py-1.5 bg-[#090d16] border border-slate-800 text-slate-200 text-xs rounded-lg focus:outline-none focus:border-cyan-500 font-mono"
            >
              {commits.map((c) => (
                <option key={c.sha} value={c.sha}>
                  {c.sha.substring(0, 8)} — {c.message.substring(0, 24)}
                </option>
              ))}
            </select>
          )}

          {/* Multi-file selector when commit touched multiple files */}
          {impactList.length > 1 && (
            <div className="flex items-center space-x-1.5 bg-[#090d16] px-2 py-1 border border-cyan-800/60 rounded-lg">
              <span className="text-[11px] text-cyan-400 font-mono font-medium">File:</span>
              <select
                value={selectedFileIndex}
                onChange={(e) => setSelectedFileIndex(Number(e.target.value))}
                className="px-2 py-0.5 bg-[#0f172a] border border-slate-700 text-slate-200 text-xs rounded focus:outline-none font-mono"
              >
                {impactList.map((imp, idx) => (
                  <option key={idx} value={idx}>
                    {imp.file_path || imp.changed_node || `File #${idx + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Main Canvas Area */}
      <div
        ref={containerRef}
        className="relative bg-[#0f172a] border border-slate-800/80 rounded-xl overflow-hidden min-h-[520px]"
      >
        {viewMode === 'orbit' && (
          <div className="absolute top-4 right-4 z-10 flex flex-col space-y-1.5 bg-[#090d16]/80 backdrop-blur border border-slate-800 p-1.5 rounded-lg shadow-lg">
            <button
              onClick={handleResetZoom}
              title="Reset Zoom & Pan"
              className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="absolute top-4 left-4 z-10 bg-[#090d16]/80 backdrop-blur border border-slate-800 p-3 rounded-lg text-xs space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            Impact Distance
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full bg-cyan-400 shadow-sm shadow-cyan-400/50" />
            <span className="text-slate-300 font-medium">Changed Node (Center)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span className="text-slate-300">Direct Impact (1 Hop)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-violet-400" />
            <span className="text-slate-300">Transitive Impact (2+ Hops)</span>
          </div>
        </div>

        {hoveredNode && (
          <div className="absolute bottom-4 left-4 right-4 z-10 bg-[#090d16]/90 backdrop-blur border border-slate-800 p-3 rounded-lg flex items-center justify-between text-xs animate-fade-in">
            <div className="flex items-center space-x-2">
              <Info className="w-4 h-4 text-cyan-400 shrink-0" />
              <div>
                <span className="text-slate-500 font-mono">Full Symbol Name: </span>
                <span className="font-mono text-slate-200 font-semibold">{hoveredNode.name}</span>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-slate-800 text-cyan-300">
              {hoveredNode.type} impact
            </span>
          </div>
        )}

        {isLoading ? (
          <div className="h-[500px] flex flex-col items-center justify-center space-y-3 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
            <span className="text-xs">Computing force-directed impact layout...</span>
          </div>
        ) : isError ? (
          <div className="h-[500px] flex flex-col items-center justify-center text-rose-400 space-y-2">
            <AlertCircle className="w-6 h-6" />
            <span className="text-xs">{(error as any)?.message || 'Failed to load impact graph'}</span>
          </div>
        ) : !impact ? (
          <div className="h-[500px] flex flex-col items-center justify-center text-slate-500 text-xs">
            No impact subgraph data available.
          </div>
        ) : viewMode === 'orbit' ? (
          <svg ref={svgRef} className="w-full h-[500px] cursor-grab active:cursor-grabbing" />
        ) : (
          <div className="w-full p-6 overflow-y-auto max-h-[500px]">
            <svg ref={matrixSvgRef} className="w-full" />
          </div>
        )}
      </div>
    </div>
  );
};
