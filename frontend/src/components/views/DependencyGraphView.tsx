import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as d3 from 'd3';
import { api } from '../../api/client';
import type {
  ImpactSubgraphResult,
  ImpactDetailedResult,
  CodeBertInsights,
} from '../../api/client';
import { useRepoContext } from '../../context/useRepoContext';
import {
  Network,
  RotateCcw,
  Loader2,
  AlertCircle,
  Info,
  Grid,
  Search,
  ZoomIn,
  ZoomOut,
  Maximize,
  Table,
  ChevronLeft,
  ChevronRight,
  Download,
  ChevronDown,
} from 'lucide-react';

import { computeVisible, type GraphFiltersState } from '../graph/graphUtils';
import { GraphFilters } from '../graph/GraphFilters';
import { GraphStatsStrip } from '../graph/GraphStatsStrip';
import { NodeInspector } from '../graph/NodeInspector';
import { ImpactTable } from '../graph/ImpactTable';
import { CodeBertPanel } from '../graph/CodeBertPanel';
import { downloadJSON, downloadCSV, downloadSVG } from '../graph/exporters';

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  label: string;
  type: 'changed' | 'direct' | 'transitive';
  impactDistance: number;
  node_type?: string;
  file?: string;
  in_degree?: number;
  out_degree?: number;
  codeBertScore?: number | null;
  codeBertPercentile?: number | null;
  isLatent?: boolean;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  relation?: string;
  synthetic?: boolean;
  isLatent?: boolean;
}

export const DependencyGraphView: React.FC = () => {
  const { jobId, selectedCommitSha, setSelectedCommitSha } = useRepoContext();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const matrixSvgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const nodePositionsRef = useRef<Map<string, { x: number; y: number; vx?: number; vy?: number }>>(new Map());
  const nodesRef = useRef<GraphNode[]>([]);

  const [viewMode, setViewMode] = useState<'orbit' | 'matrix' | 'table'>('orbit');
  const [colorBy, setColorBy] = useState<'distance' | 'codebert'>('distance');
  const [nodeSearch, setNodeSearch] = useState<string>('');
  const [searchMatchIndex, setSearchMatchIndex] = useState<number>(0);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(800);
  const [isExportOpen, setIsExportOpen] = useState<boolean>(false);
  const [shouldFetchCodeBert, setShouldFetchCodeBert] = useState<boolean>(false);
  const [addedLatentNodes, setAddedLatentNodes] = useState<
    CodeBertInsights['latent_dependencies']
  >([]);
  const [fileSelection, setFileSelection] = useState<{ sha: string | null; index: number }>({
    sha: null,
    index: 0,
  });

  // Graph Filters state
  const [filters, setFilters] = useState<GraphFiltersState>({
    maxHop: 3,
    relations: new Set(['calls', 'imports', 'defines', 'synthetic']),
    nodeTypes: new Set(),
    direction: 'both',
    hideOrphans: false,
  });

  const { data: commits } = useQuery({
    queryKey: ['commits', jobId],
    queryFn: () => api.getCommits(jobId!, 50, 0),
    enabled: !!jobId && !selectedCommitSha,
  });

  const activeSha = selectedCommitSha || (commits && commits.length > 0 ? commits[0].sha : null);

  const {
    data: detailedImpact,
    isLoading: isDetailedLoading,
    isError: isDetailedError,
  } = useQuery<ImpactDetailedResult>({
    queryKey: ['impact', 'detailed', activeSha],
    queryFn: () => api.getCommitImpactDetailed(activeSha!, 3),
    enabled: !!activeSha,
    retry: 1,
  });

  const {
    data: rawImpact,
    isLoading: isFallbackLoading,
    isError: isFallbackError,
    error: fallbackError,
  } = useQuery<ImpactSubgraphResult | ImpactSubgraphResult[]>({
    queryKey: ['impact', activeSha],
    queryFn: () => api.getCommitImpact(jobId || '', activeSha!),
    enabled: !!activeSha && isDetailedError,
  });

  // Opt-in CodeBERT insights query
  const {
    data: insightsData,
    isLoading: isInsightsLoading,
    error: insightsErrorObj,
    refetch: refetchInsights,
  } = useQuery<CodeBertInsights>({
    queryKey: ['impact', 'codebert', activeSha],
    queryFn: () => api.getCodeBertInsights(activeSha!, 3, 8),
    enabled: !!activeSha && shouldFetchCodeBert,
    retry: false,
  });

  // If CodeBERT server indicates model is loading, poll until ready
  useEffect(() => {
    if (insightsData?.status === 'loading' && shouldFetchCodeBert) {
      const timer = setTimeout(() => {
        refetchInsights();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [insightsData?.status, shouldFetchCodeBert, refetchInsights]);

  // Reset latent nodes and opt-in state on commit change
  useEffect(() => {
    setAddedLatentNodes([]);
    setShouldFetchCodeBert(false);
  }, [activeSha]);

  const hasCodeBertScores = useMemo(() => {
    if (!insightsData?.node_scores) return false;
    return Object.values(insightsData.node_scores).some(
      (s) => s.semantic_score !== null && s.semantic_score !== undefined
    );
  }, [insightsData]);

  const isLoading = isDetailedLoading || (isDetailedError && isFallbackLoading);
  const isError = isDetailedError && isFallbackError;
  const isBasicMode = isDetailedError && !isFallbackLoading && !!rawImpact;

  const impactList: ImpactSubgraphResult[] = useMemo(() => {
    if (!rawImpact) return [];
    return Array.isArray(rawImpact) ? rawImpact : [rawImpact];
  }, [rawImpact]);

  const selectedFileIndex = fileSelection.sha === activeSha ? fileSelection.index : 0;
  const impact: ImpactSubgraphResult | null = impactList[selectedFileIndex] || impactList[0] || null;

  // Available metadata for filters
  const availableRelations = useMemo(() => {
    if (!detailedImpact) return ['calls', 'imports', 'defines', 'synthetic'];
    const set = new Set<string>();
    detailedImpact.edges.forEach((e) => {
      const rel = e.relation || (e.synthetic ? 'synthetic' : 'unknown');
      set.add(rel);
    });
    return Array.from(set).sort();
  }, [detailedImpact]);

  const availableNodeTypes = useMemo(() => {
    if (!detailedImpact) return [];
    const set = new Set<string>();
    detailedImpact.nodes.forEach((n) => {
      if (n.node_type) set.add(n.node_type);
    });
    return Array.from(set).sort();
  }, [detailedImpact]);

  // Compute filtered visible graph
  const { visibleNodes, visibleEdges, isTruncated } = useMemo(() => {
    if (isDetailedError || !detailedImpact) {
      return { visibleNodes: [], visibleEdges: [], isTruncated: false };
    }
    const res = computeVisible(
      detailedImpact.nodes,
      detailedImpact.edges,
      filters,
      detailedImpact.changed_node
    );
    return {
      visibleNodes: res.nodes,
      visibleEdges: res.edges,
      isTruncated: res.truncated,
    };
  }, [detailedImpact, isDetailedError, filters]);

  const hasData = (!isDetailedError && !!detailedImpact) || (isDetailedError && !!impact);

  const addedLatentNodeIds = useMemo(
    () => new Set(addedLatentNodes.map((n) => n.id)),
    [addedLatentNodes]
  );

  const handleToggleLatentNode = (
    node: CodeBertInsights['latent_dependencies'][number]
  ) => {
    setAddedLatentNodes((prev) => {
      if (prev.some((n) => n.id === node.id)) {
        return prev.filter((n) => n.id !== node.id);
      }
      return [...prev, node];
    });
  };

  const handleTriggerInsights = () => {
    setShouldFetchCodeBert(true);
    refetchInsights();
  };

  // FIX 3: Container resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(entry.contentRect.width);
        }
      }
    });
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Search matches computation
  const searchMatches = useMemo(() => {
    const q = nodeSearch.trim().toLowerCase();
    if (!q) return [];
    const pool =
      !isDetailedError && detailedImpact ? visibleNodes : (nodesRef.current as any[]);
    return pool.filter(
      (n: any) =>
        n.id.toLowerCase().includes(q) ||
        (n.label && n.label.toLowerCase().includes(q))
    );
  }, [nodeSearch, isDetailedError, detailedImpact, visibleNodes]);

  const centerNodeInOrbit = (nodeId: string) => {
    if (viewMode !== 'orbit' || !svgRef.current || !zoomRef.current) return;
    const target = nodesRef.current.find((n) => n.id === nodeId);
    if (target && target.x !== undefined && target.y !== undefined) {
      const width = containerWidth || 800;
      const height = 500;
      const transform = d3.zoomIdentity
        .translate(width / 2 - target.x * 1.5, height / 2 - target.y * 1.5)
        .scale(1.5);
      d3.select(svgRef.current).transition().duration(750).call(zoomRef.current.transform, transform);
    }
  };

  // Keyboard navigation: "/" focuses search, "Escape" clears, Enter cycles matches
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/') {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
          return;
        }
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape') {
        setNodeSearch('');
        setSelectedNodeId(null);
        setHoveredNode(null);
        setHoveredNodeId(null);
        setIsExportOpen(false);
        searchInputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchMatches.length > 0) {
      e.preventDefault();
      const nextIdx = (searchMatchIndex + 1) % searchMatches.length;
      setSearchMatchIndex(nextIdx);
      const target = searchMatches[nextIdx];
      if (target) {
        setSelectedNodeId(target.id);
        centerNodeInOrbit(target.id);
      }
    }
  };

  // Color mapping helper
  const codeBertColorScale = useMemo(
    () => d3.interpolateRgbBasis(['#22d3ee', '#f59e0b', '#f43f5e']),
    []
  );

  const getNodeColor = (d: GraphNode) => {
    if (d.isLatent) return '#8b5cf6';
    if (colorBy === 'codebert' && hasCodeBertScores) {
      if (d.codeBertScore !== undefined && d.codeBertScore !== null) {
        return codeBertColorScale(Math.max(0, Math.min(1, d.codeBertScore)));
      }
      return '#64748b';
    }
    return d.type === 'changed' ? '#38bdf8' : d.type === 'direct' ? '#f59e0b' : '#8b5cf6';
  };

  const getNodeStroke = (d: GraphNode) => {
    if (d.isLatent) return '#c084fc';
    if (colorBy === 'codebert' && hasCodeBertScores) {
      return '#334155';
    }
    return d.type === 'changed' ? '#7dd3fc' : d.type === 'direct' ? '#fde68a' : '#c084fc';
  };

  /**
   * D3 Force Orbit Render Function
   */
  useEffect(() => {
    if (viewMode !== 'orbit' || !svgRef.current) return;
    if (isDetailedError && !impact) return;
    if (!isDetailedError && !detailedImpact) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = containerWidth || containerRef.current?.clientWidth || 800;
    const height = 500;

    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];

    if (!isDetailedError && detailedImpact) {
      visibleNodes.forEach((n) => {
        const scoreInfo = insightsData?.node_scores?.[n.id];
        nodes.push({
          id: n.id,
          name: n.id,
          label: n.label,
          type: n.hop === 0 ? 'changed' : n.hop === 1 ? 'direct' : 'transitive',
          impactDistance: n.hop,
          node_type: n.node_type,
          file: n.file,
          in_degree: n.in_degree,
          out_degree: n.out_degree,
          codeBertScore: scoreInfo?.semantic_score ?? null,
          codeBertPercentile: scoreInfo?.percentile ?? null,
        });
      });

      // Add added latent nodes
      addedLatentNodes.forEach((ld) => {
        nodes.push({
          id: ld.id,
          name: ld.id,
          label: ld.label || ld.id,
          type: 'transitive',
          impactDistance: 3,
          node_type: ld.node_type,
          file: ld.file,
          in_degree: 0,
          out_degree: 0,
          codeBertScore: ld.score,
          codeBertPercentile: ld.percentile,
          isLatent: true,
        });
      });

      const nodeSet = new Set(nodes.map((d) => d.id));
      visibleEdges.forEach((e) => {
        const s = typeof e.source === 'object' && e.source !== null ? (e.source as any).id : String(e.source);
        const t = typeof e.target === 'object' && e.target !== null ? (e.target as any).id : String(e.target);
        if (nodeSet.has(s) && nodeSet.has(t)) {
          links.push({
            source: s,
            target: t,
            relation: e.relation,
            synthetic: e.synthetic,
          });
        }
      });

      // Add latent edges connected to changed root
      const rootId = detailedImpact.changed_node;
      addedLatentNodes.forEach((ld) => {
        if (nodeSet.has(rootId) && nodeSet.has(ld.id)) {
          links.push({
            source: rootId,
            target: ld.id,
            relation: 'latent',
            synthetic: true,
            isLatent: true,
          });
        }
      });
    } else if (impact) {
      nodes.push({
        id: impact.changed_node,
        name: impact.changed_node,
        label: impact.changed_node.split(':').pop() || impact.changed_node,
        type: 'changed',
        impactDistance: 0,
      });

      impact.direct_impacts.forEach((name) => {
        nodes.push({
          id: name,
          name: name,
          label: name.split(':').pop() || name,
          type: 'direct',
          impactDistance: 1,
        });
      });

      impact.transitive_impacts.forEach((name) => {
        nodes.push({
          id: name,
          name: name,
          label: name.split(':').pop() || name,
          type: 'transitive',
          impactDistance: 2,
        });
      });

      impact.direct_impacts.forEach((directName) => {
        links.push({ source: impact.changed_node, target: directName, relation: 'calls', synthetic: false });
        impact.transitive_impacts.forEach((transName) => {
          links.push({ source: directName, target: transName, relation: 'calls', synthetic: false });
        });
      });
    }

    if (nodes.length === 0) return;

    // Restore cached node positions
    nodes.forEach((d) => {
      const cached = nodePositionsRef.current.get(d.id);
      if (cached) {
        d.x = cached.x;
        d.y = cached.y;
        d.vx = cached.vx;
        d.vy = cached.vy;
      }
    });
    nodesRef.current = nodes;

    const defs = svg.append('defs');

    const markers = [
      { id: 'arrow-calls', color: '#22d3ee' },
      { id: 'arrow-imports', color: '#818cf8' },
      { id: 'arrow-defines', color: '#94a3b8' },
      { id: 'arrow-synthetic', color: '#475569' },
      { id: 'arrow-latent', color: '#8b5cf6' },
      { id: 'arrow-default', color: '#64748b' },
    ];

    markers.forEach(({ id, color }) => {
      defs
        .append('marker')
        .attr('id', id)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 20)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', color);
    });

    const g = svg.append('g').attr('class', 'main-group');

    // FIX 1: Store d3.zoom behavior in useRef
    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 5])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    zoomRef.current = zoomBehavior;
    svg.call(zoomBehavior);

    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance((d) => {
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
      .attr('stroke', (d) => {
        if (d.isLatent) return '#8b5cf6';
        if (d.synthetic) return '#475569';
        if (d.relation === 'calls') return '#22d3ee';
        if (d.relation === 'imports') return '#818cf8';
        if (d.relation === 'defines') return '#94a3b8';
        return '#334155';
      })
      .attr('stroke-opacity', (d) => {
        if (d.isLatent) return 0.85;
        if (d.synthetic) return 0.25;
        if (d.relation === 'calls') return 0.85;
        if (d.relation === 'imports') return 0.8;
        if (d.relation === 'defines') return 0.7;
        return 0.6;
      })
      .attr('stroke-width', (d) => (d.synthetic && !d.isLatent ? 1 : 1.5))
      .attr('stroke-dasharray', (d) => {
        if (d.isLatent) return '2,3';
        if (d.synthetic) return '4,4';
        if (d.relation === 'defines') return '2,3';
        return 'none';
      })
      .attr('marker-end', (d) => {
        if (d.isLatent) return 'url(#arrow-latent)';
        if (d.synthetic) return 'url(#arrow-synthetic)';
        if (d.relation === 'calls') return 'url(#arrow-calls)';
        if (d.relation === 'imports') return 'url(#arrow-imports)';
        if (d.relation === 'defines') return 'url(#arrow-defines)';
        return 'url(#arrow-default)';
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
      .attr('fill', (d) => getNodeColor(d))
      .attr('stroke', (d) => getNodeStroke(d))
      .attr('stroke-dasharray', (d) => (d.isLatent ? '3,3' : 'none'))
      .attr('stroke-width', (d) => (d.isLatent ? 2 : d.type === 'changed' ? 3 : 1.5))
      .style('filter', (d) => (d.type === 'changed' ? 'drop-shadow(0 0 10px rgba(56, 189, 248, 0.6))' : 'none'));

    nodeGroup
      .append('text')
      .text((d) => {
        const text = d.label || d.name.split(':').pop() || d.name;
        return text.length > 18 ? text.substring(0, 16) + '...' : text;
      })
      .attr('x', 0)
      .attr('y', (d) => (d.type === 'changed' ? 30 : 22))
      .attr('text-anchor', 'middle')
      .attr('fill', '#94a3b8')
      .attr('font-size', '10px')
      .attr('font-weight', (d) => (d.type === 'changed' ? '600' : '400'));

    nodeGroup
      .on('mouseenter', (_, d) => {
        setHoveredNode(d);
        setHoveredNodeId(d.id);
      })
      .on('mouseleave', () => {
        setHoveredNode(null);
        setHoveredNodeId(null);
      })
      .on('click', (event, d) => {
        event.stopPropagation();
        setSelectedNodeId(d.id);
        if (d.x !== undefined && d.y !== undefined && zoomRef.current) {
          const transform = d3.zoomIdentity.translate(width / 2 - d.x * 1.5, height / 2 - d.y * 1.5).scale(1.5);
          svg.transition().duration(750).call(zoomRef.current.transform, transform);
        }
      });

    simulation.on('tick', () => {
      nodes.forEach((n) => {
        if (n.x !== undefined && n.y !== undefined) {
          nodePositionsRef.current.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy });
        }
      });

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
  }, [
    viewMode,
    containerWidth,
    detailedImpact,
    isDetailedError,
    impact,
    visibleNodes,
    visibleEdges,
    addedLatentNodes,
    insightsData,
  ]);

  /**
   * FIX 2 & Hover highlighting: style update only, without restarting simulation
   */
  useEffect(() => {
    if (viewMode !== 'orbit' || !svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const query = nodeSearch.trim().toLowerCase();

    let neighborSet: Set<string> | null = null;
    if (hoveredNodeId) {
      neighborSet = new Set<string>([hoveredNodeId]);
      const poolEdges = !isDetailedError && detailedImpact ? visibleEdges : [];
      poolEdges.forEach((e) => {
        const s = typeof e.source === 'object' && e.source !== null ? (e.source as any).id : String(e.source);
        const t = typeof e.target === 'object' && e.target !== null ? (e.target as any).id : String(e.target);
        if (s === hoveredNodeId) neighborSet!.add(t);
        if (t === hoveredNodeId) neighborSet!.add(s);
      });
    }

    svg.selectAll<SVGGElement, GraphNode>('.node').each(function (d) {
      const g = d3.select(this);

      if (neighborSet) {
        const isInNeighborhood = neighborSet.has(d.id);
        const isHoverTarget = d.id === hoveredNodeId;

        g.select('circle')
          .attr('fill', isHoverTarget ? '#38bdf8' : getNodeColor(d))
          .attr('opacity', isInNeighborhood ? 1 : 0.2)
          .attr('stroke-width', isHoverTarget ? 3.5 : d.isLatent ? 2 : d.type === 'changed' ? 3 : 1.5);

        g.select('text')
          .attr('fill', isHoverTarget ? '#38bdf8' : '#94a3b8')
          .attr('opacity', isInNeighborhood ? 1 : 0.2);
      } else {
        const isMatch =
          !query ||
          d.name.toLowerCase().includes(query) ||
          (d.label && d.label.toLowerCase().includes(query));
        const isHighlighted =
          query.length > 0 &&
          (d.name.toLowerCase().includes(query) || (d.label && d.label.toLowerCase().includes(query)));

        g.select('circle')
          .attr('fill', isHighlighted ? '#38bdf8' : getNodeColor(d))
          .attr('stroke', getNodeStroke(d))
          .attr('opacity', isMatch ? 1 : 0.25)
          .attr('stroke-width', d.isLatent ? 2 : d.type === 'changed' ? 3 : 1.5);

        g.select('text')
          .attr('fill', isHighlighted ? '#38bdf8' : '#94a3b8')
          .attr('opacity', isMatch ? 1 : 0.25);
      }
    });

    svg.selectAll<SVGLineElement, GraphLink>('line').each(function (d) {
      const line = d3.select(this);
      const s = typeof d.source === 'object' ? (d.source as any).id : d.source;
      const t = typeof d.target === 'object' ? (d.target as any).id : d.target;

      if (neighborSet) {
        const isIncident = s === hoveredNodeId || t === hoveredNodeId;
        line.attr('opacity', isIncident ? 1 : 0.15).attr('stroke-width', isIncident ? 2 : 1);
      } else if (!query) {
        line.attr('opacity', 1).attr('stroke-width', d.synthetic && !d.isLatent ? 1 : 1.5);
      } else {
        const sMatch = s ? s.toLowerCase().includes(query) : false;
        const tMatch = t ? t.toLowerCase().includes(query) : false;
        line.attr('opacity', sMatch || tMatch ? 1 : 0.25);
      }
    });
  }, [
    nodeSearch,
    hoveredNodeId,
    viewMode,
    colorBy,
    isDetailedError,
    detailedImpact,
    visibleEdges,
    hasCodeBertScores,
    codeBertColorScale,
  ]);

  /**
   * D3 Impact Matrix Heat-Grid Render Function (FIX 3: Width responsive)
   */
  useEffect(() => {
    if (viewMode !== 'matrix' || !matrixSvgRef.current) return;
    if (isDetailedError && !impact) return;
    if (!isDetailedError && !detailedImpact) return;

    const svg = d3.select(matrixSvgRef.current);
    svg.selectAll('*').remove();

    const width = containerWidth;
    let targets: Array<{ name: string; label: string; isDirect: boolean; hop: number }> = [];

    if (!isDetailedError && detailedImpact) {
      targets = visibleNodes
        .filter((n) => n.hop > 0)
        .map((n) => ({
          name: n.id,
          label: n.label || n.id,
          isDirect: n.hop === 1,
          hop: n.hop,
        }));
    } else if (impact) {
      const direct = impact.direct_impacts.map((name) => ({
        name,
        label: name.split(':').pop() || name,
        isDirect: true,
        hop: 1,
      }));
      const transitive = impact.transitive_impacts.map((name) => ({
        name,
        label: name.split(':').pop() || name,
        isDirect: false,
        hop: 2,
      }));
      targets = [...direct, ...transitive];
    }

    const rowHeight = 36;
    const height = Math.max(300, targets.length * rowHeight + 80);

    svg.attr('viewBox', `0 0 ${width} ${height}`);
    svg.attr('width', width);

    const g = svg.append('g').attr('transform', 'translate(180, 40)');

    targets.forEach((target, idx) => {
      const isDirect = target.isDirect;
      const rowY = idx * rowHeight;

      g.append('rect')
        .attr('x', 0)
        .attr('y', rowY)
        .attr('width', Math.max(100, width - 220))
        .attr('height', rowHeight - 6)
        .attr('fill', '#090d16')
        .attr('rx', 6)
        .attr('stroke', '#1e293b');

      g.append('text')
        .text(target.label)
        .attr('x', -10)
        .attr('y', rowY + 18)
        .attr('text-anchor', 'end')
        .attr('fill', isDirect ? '#f59e0b' : '#c084fc')
        .attr('font-size', '11px')
        .attr('font-family', 'monospace');

      g.append('circle')
        .attr('cx', 40)
        .attr('cy', rowY + 15)
        .attr('r', isDirect ? 10 : 7)
        .attr('fill', isDirect ? '#f59e0b' : '#8b5cf6')
        .attr('opacity', isDirect ? 0.9 : 0.6);

      g.append('text')
        .text(isDirect ? 'Direct 1-Hop Impact' : `Transitive ${target.hop > 1 ? target.hop : '2+'}+ Hop Impact`)
        .attr('x', 70)
        .attr('y', rowY + 19)
        .attr('fill', '#94a3b8')
        .attr('font-size', '11px');
    });
  }, [viewMode, containerWidth, detailedImpact, isDetailedError, impact, visibleNodes]);

  const handleZoomIn = () => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, 1.3);
  };

  const handleZoomOut = () => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, 0.77);
  };

  const handleFitToView = () => {
    if (!svgRef.current || !zoomRef.current || nodesRef.current.length === 0) return;
    const width = containerWidth || 800;
    const height = 500;
    const padding = 40;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const node of nodesRef.current) {
      if (node.x !== undefined && node.y !== undefined) {
        if (node.x < minX) minX = node.x;
        if (node.x > maxX) maxX = node.x;
        if (node.y < minY) minY = node.y;
        if (node.y > maxY) maxY = node.y;
      }
    }

    if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) return;

    const dx = maxX - minX || 1;
    const dy = maxY - minY || 1;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const scale = Math.max(0.2, Math.min(3, Math.min((width - padding * 2) / dx, (height - padding * 2) / dy)));
    const transform = d3.zoomIdentity
      .translate(width / 2 - scale * cx, height / 2 - scale * cy)
      .scale(scale);

    d3.select(svgRef.current).transition().duration(750).call(zoomRef.current.transform, transform);
  };

  const handleResetZoom = () => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(500).call(zoomRef.current.transform, d3.zoomIdentity);
  };

  const handleExportSVG = () => {
    if (!svgRef.current) return;
    downloadSVG(`dependency_graph_${activeSha?.substring(0, 8) || 'commit'}.svg`, svgRef.current);
    setIsExportOpen(false);
  };

  const handleExportJSON = () => {
    const base = detailedImpact || impact;
    if (!base) return;
    const exportPayload = {
      ...base,
      codebert_insights: insightsData || null,
    };
    downloadJSON(`impact_${activeSha?.substring(0, 8) || 'commit'}.json`, exportPayload);
    setIsExportOpen(false);
  };

  const handleExportCSV = () => {
    const list =
      !isDetailedError && detailedImpact
        ? visibleNodes
        : (nodesRef.current as any[]);
    const rows = list.map((n: any) => ({
      id: n.id,
      symbol: n.label || n.id,
      type: n.node_type || 'unknown',
      file: n.file || '',
      hop: n.hop ?? n.impactDistance ?? 0,
      in_degree: n.in_degree ?? 0,
      out_degree: n.out_degree ?? 0,
      codebert_score: insightsData?.node_scores?.[n.id]?.semantic_score ?? '',
    }));
    downloadCSV(`impact_nodes_${activeSha?.substring(0, 8) || 'commit'}.csv`, rows);
    setIsExportOpen(false);
  };

  // Find currently selected node object for inspector
  const activeInspectorNode = useMemo(() => {
    if (!selectedNodeId) return null;
    if (!isDetailedError && detailedImpact) {
      const found = detailedImpact.nodes.find((n) => n.id === selectedNodeId);
      const scoreInfo = insightsData?.node_scores?.[selectedNodeId];
      if (found) {
        return {
          ...found,
          codeBertScore: scoreInfo?.semantic_score ?? null,
          codeBertPercentile: scoreInfo?.percentile ?? null,
        };
      }
      const latentFound = addedLatentNodes.find((l) => l.id === selectedNodeId);
      if (latentFound) {
        return {
          id: latentFound.id,
          label: latentFound.label,
          file: latentFound.file,
          node_type: latentFound.node_type,
          hop: 3,
          codeBertScore: latentFound.score,
          codeBertPercentile: latentFound.percentile,
        };
      }
      return { id: selectedNodeId };
    }
    const found = nodesRef.current.find((n) => n.id === selectedNodeId);
    return found ? { id: found.id, label: found.label, hop: found.impactDistance } : { id: selectedNodeId };
  }, [selectedNodeId, isDetailedError, detailedImpact, insightsData, addedLatentNodes]);

  return (
    <div className="space-y-4">
      {/* Top Bar: Selector, Stepper, Search, View Toggle, Color Toggle, Export */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-[#0f172a] p-5 border border-slate-800/80 rounded-xl">
        <div className="flex items-center space-x-3">
          <Network className="w-5 h-5 text-cyan-400 shrink-0" />
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
          {/* View Mode Toggle: Orbit, Matrix, Table */}
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
              <span>Orbit</span>
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
              <span>Matrix</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1 text-xs font-medium rounded-md flex items-center space-x-1.5 transition-all ${
                viewMode === 'table'
                  ? 'bg-cyan-950 text-cyan-400 border border-cyan-500/50'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Table className="w-3.5 h-3.5" />
              <span>Table</span>
            </button>
          </div>

          {/* Colour By Dropdown */}
          <div className="flex items-center space-x-1.5 bg-[#090d16] px-2.5 py-1 border border-slate-800 rounded-lg">
            <span className="text-[11px] text-slate-400 font-medium">Colour by:</span>
            <select
              value={colorBy}
              onChange={(e) => setColorBy(e.target.value as 'distance' | 'codebert')}
              className="px-1.5 py-0.5 bg-transparent text-slate-200 text-xs rounded focus:outline-none cursor-pointer"
            >
              <option value="distance" className="bg-[#0f172a]">
                Impact distance
              </option>
              <option
                value="codebert"
                disabled={!hasCodeBertScores}
                className="bg-[#0f172a] disabled:text-slate-600"
              >
                CodeBERT score {!hasCodeBertScores ? '(run analysis first)' : ''}
              </option>
            </select>
          </div>

          {/* Node Search Bar with "/" hint & N matches counter */}
          <div className="flex items-center space-x-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search symbol... (/)"
                value={nodeSearch}
                onChange={(e) => {
                  setNodeSearch(e.target.value);
                  setSearchMatchIndex(0);
                }}
                onKeyDown={handleSearchKeyDown}
                className="pl-8 pr-3 py-1.5 bg-[#090d16] border border-slate-800 text-slate-200 text-xs rounded-lg focus:outline-none focus:border-cyan-500 w-44"
              />
            </div>
            {nodeSearch.trim().length > 0 && (
              <span className="text-[11px] text-cyan-400 font-mono bg-cyan-950/60 px-2 py-1 rounded border border-cyan-800/60 whitespace-nowrap">
                {searchMatches.length} {searchMatches.length === 1 ? 'match' : 'matches'}
              </span>
            )}
          </div>

          {/* Commit Picker with ← → Steppers */}
          {commits && commits.length > 0 && (
            <div className="flex items-center space-x-1 bg-[#090d16] p-0.5 border border-slate-800 rounded-lg">
              <button
                onClick={() => {
                  const currIdx = commits.findIndex((c) => c.sha === activeSha);
                  if (currIdx > 0) {
                    setSelectedCommitSha(commits[currIdx - 1].sha);
                  }
                }}
                disabled={commits.findIndex((c) => c.sha === activeSha) <= 0}
                className="p-1 rounded text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors"
                title="Previous commit"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <select
                value={activeSha || ''}
                onChange={(e) => setSelectedCommitSha(e.target.value)}
                className="px-2 py-1 bg-transparent text-slate-200 text-xs rounded focus:outline-none font-mono"
              >
                {commits.map((c) => (
                  <option key={c.sha} value={c.sha} className="bg-[#0f172a]">
                    {c.sha.substring(0, 8)} — {c.message.substring(0, 24)}
                  </option>
                ))}
              </select>

              <button
                onClick={() => {
                  const currIdx = commits.findIndex((c) => c.sha === activeSha);
                  if (currIdx >= 0 && currIdx < commits.length - 1) {
                    setSelectedCommitSha(commits[currIdx + 1].sha);
                  }
                }}
                disabled={commits.findIndex((c) => c.sha === activeSha) >= commits.length - 1}
                className="p-1 rounded text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors"
                title="Next commit"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Multi-file selector when commit touched multiple files */}
          {impactList.length > 1 && (
            <div className="flex items-center space-x-1.5 bg-[#090d16] px-2 py-1 border border-cyan-800/60 rounded-lg">
              <span className="text-[11px] text-cyan-400 font-mono font-medium">File:</span>
              <select
                value={selectedFileIndex}
                onChange={(e) => setFileSelection({ sha: activeSha, index: Number(e.target.value) })}
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

          {/* Export Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsExportOpen(!isExportOpen)}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#090d16] hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-lg text-xs transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>Export</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {isExportOpen && (
              <div className="absolute right-0 mt-1.5 w-36 bg-[#090d16] border border-slate-800 rounded-lg shadow-xl z-30 py-1 text-xs">
                {viewMode === 'orbit' && (
                  <button
                    onClick={handleExportSVG}
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 transition-colors"
                  >
                    Export SVG
                  </button>
                )}
                <button
                  onClick={handleExportJSON}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 transition-colors"
                >
                  Export JSON
                </button>
                <button
                  onClick={handleExportCSV}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 transition-colors"
                >
                  Export CSV
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Secondary Collapsible Filters (closed by default; hidden in basic mode) */}
      {!isBasicMode && detailedImpact && (
        <GraphFilters
          filters={filters}
          onChange={setFilters}
          availableRelations={availableRelations}
          availableNodeTypes={availableNodeTypes}
          totalNodesCount={detailedImpact.nodes.length}
          visibleNodesCount={visibleNodes.length}
        />
      )}

      {/* Quiet Statistics Strip (hidden in basic mode) */}
      {!isBasicMode && detailedImpact && (
        <GraphStatsStrip stats={detailedImpact.stats} />
      )}

      {/* Truncation Notice */}
      {isTruncated && (
        <div className="flex items-center space-x-2 bg-cyan-950/30 border border-cyan-800/40 px-3 py-1.5 rounded-lg text-cyan-300 text-xs">
          <Info className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
          <span>Showing top 300 nodes by connectivity.</span>
        </div>
      )}

      {/* Fallback basic mode amber banner */}
      {isBasicMode && (
        <div className="flex items-center space-x-2 bg-amber-500/10 border border-amber-500/30 px-4 py-2 rounded-xl text-amber-400 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
          <span>Basic mode — real dependency edges unavailable.</span>
        </div>
      )}

      {/* Main Canvas Area */}
      <div
        ref={containerRef}
        className="relative bg-[#0f172a] border border-slate-800/80 rounded-xl overflow-hidden min-h-[520px]"
      >
        {/* Orbit View Toolbar Controls */}
        {viewMode === 'orbit' && (
          <div className="absolute top-4 right-4 z-10 flex flex-col space-y-1.5 bg-[#090d16]/80 backdrop-blur border border-slate-800 p-1.5 rounded-lg shadow-lg">
            <button
              onClick={handleZoomIn}
              title="Zoom In"
              className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded transition-colors"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={handleZoomOut}
              title="Zoom Out"
              className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded transition-colors"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={handleFitToView}
              title="Fit to View"
              className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded transition-colors"
            >
              <Maximize className="w-4 h-4" />
            </button>
            <button
              onClick={handleResetZoom}
              title="Reset Zoom & Pan"
              className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Legend */}
        <div className="absolute top-4 left-4 z-10 bg-[#090d16]/80 backdrop-blur border border-slate-800 p-3 rounded-lg text-xs space-y-2 max-w-[200px]">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            Legend
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full bg-cyan-400 shadow-sm shadow-cyan-400/50" />
            <span className="text-slate-300 font-medium">Changed Node</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span className="text-slate-300">Direct Impact (1 Hop)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-violet-400" />
            <span className="text-slate-300">Transitive Impact (2+ Hops)</span>
          </div>
          {addedLatentNodes.length > 0 && (
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full border-2 border-dashed border-violet-400 bg-violet-950" />
              <span className="text-violet-300">Latent Dependency</span>
            </div>
          )}

          {/* Small Gradient Legend when Colour by CodeBERT score is active */}
          {colorBy === 'codebert' && hasCodeBertScores && (
            <div className="pt-2 border-t border-slate-800/80 space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                CodeBERT Score
              </div>
              <div className="h-2 rounded-full w-full bg-gradient-to-r from-cyan-400 via-amber-400 to-rose-500 shadow-sm" />
              <div className="flex justify-between text-[9px] text-slate-400 font-mono">
                <span>0.0</span>
                <span>0.5</span>
                <span>1.0</span>
              </div>
            </div>
          )}
        </div>

        {/* Hover Bar */}
        {hoveredNode && !activeInspectorNode && (
          <div className="absolute bottom-4 left-4 right-4 z-10 bg-[#090d16]/90 backdrop-blur border border-slate-800 p-3 rounded-lg flex items-center justify-between text-xs animate-fade-in">
            <div className="flex items-center space-x-2">
              <Info className="w-4 h-4 text-cyan-400 shrink-0" />
              <div>
                <span className="text-slate-500 font-mono">Full Symbol Name: </span>
                <span className="font-mono text-slate-200 font-semibold">{hoveredNode.name}</span>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              {hoveredNode.codeBertScore !== undefined && hoveredNode.codeBertScore !== null && (
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800">
                  Score: {(hoveredNode.codeBertScore * 100).toFixed(0)}%
                </span>
              )}
              <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-slate-800 text-cyan-300">
                {hoveredNode.isLatent ? 'Latent' : hoveredNode.type} impact
              </span>
            </div>
          </div>
        )}

        {/* Node Inspector Drawer */}
        {!isBasicMode && activeInspectorNode && (
          <NodeInspector
            node={activeInspectorNode}
            edges={visibleEdges}
            onSelectNode={(nodeId) => {
              setSelectedNodeId(nodeId);
              centerNodeInOrbit(nodeId);
            }}
            onClose={() => setSelectedNodeId(null)}
          />
        )}

        {/* View Canvases */}
        {isLoading ? (
          <div className="h-[500px] flex flex-col items-center justify-center space-y-3 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
            <span className="text-xs">Computing force-directed impact layout...</span>
          </div>
        ) : isError ? (
          <div className="h-[500px] flex flex-col items-center justify-center text-rose-400 space-y-2">
            <AlertCircle className="w-6 h-6" />
            <span className="text-xs">{(fallbackError as any)?.message || 'Failed to load impact graph'}</span>
          </div>
        ) : !hasData ? (
          <div className="h-[500px] flex flex-col items-center justify-center text-slate-500 text-xs">
            No impact subgraph data available.
          </div>
        ) : viewMode === 'orbit' ? (
          <svg ref={svgRef} className="w-full h-[500px] cursor-grab active:cursor-grabbing" />
        ) : viewMode === 'matrix' ? (
          <div className="w-full p-6 overflow-y-auto max-h-[500px]">
            <svg ref={matrixSvgRef} className="w-full" />
          </div>
        ) : (
          <ImpactTable
            nodes={
              !isDetailedError && detailedImpact
                ? visibleNodes.map((n) => {
                    const scoreInfo = insightsData?.node_scores?.[n.id];
                    return {
                      ...n,
                      codeBertScore: scoreInfo?.semantic_score ?? null,
                      codeBertPercentile: scoreInfo?.percentile ?? null,
                    };
                  })
                : impact
                ? [
                    { id: impact.changed_node, hop: 0 },
                    ...impact.direct_impacts.map((d) => ({ id: d, hop: 1 })),
                    ...impact.transitive_impacts.map((t) => ({ id: t, hop: 2 })),
                  ]
                : []
            }
            onSelectNodeAndOrbit={(nodeId) => {
              setSelectedNodeId(nodeId);
              setViewMode('orbit');
              setTimeout(() => centerNodeInOrbit(nodeId), 100);
            }}
            onExportCSV={handleExportCSV}
          />
        )}
      </div>

      {/* Semantic Insights (CodeBERT) Card Below the Canvas */}
      <CodeBertPanel
        activeSha={activeSha}
        insightsData={insightsData || null}
        isInsightsLoading={isInsightsLoading}
        insightsError={
          insightsErrorObj
            ? (insightsErrorObj as any)?.message || 'Failed to fetch CodeBERT insights'
            : null
        }
        onTriggerInsights={handleTriggerInsights}
        addedLatentNodeIds={addedLatentNodeIds}
        onToggleLatentNode={handleToggleLatentNode}
      />
    </div>
  );
};
