export interface GraphFiltersState {
  maxHop: 1 | 2 | 3;
  relations: Set<string>;
  nodeTypes: Set<string>;
  direction: 'both' | 'dependents' | 'dependencies';
  hideOrphans: boolean;
}

export function computeVisible<
  TNode extends { id: string; node_type?: string; hop?: number; [k: string]: any },
  TEdge extends { source: string | any; target: string | any; relation?: string; synthetic?: boolean; [k: string]: any }
>(
  nodes: TNode[],
  edges: TEdge[],
  filters: GraphFiltersState,
  changedNodeId?: string
): { nodes: TNode[]; edges: TEdge[]; truncated: boolean } {
  if (nodes.length === 0) {
    return { nodes: [], edges: [], truncated: false };
  }

  const rootId = changedNodeId || nodes.find((n) => n.hop === 0)?.id || nodes[0]?.id;

  const getSourceId = (e: TEdge): string =>
    typeof e.source === 'object' && e.source !== null && 'id' in e.source
      ? String(e.source.id)
      : String(e.source);

  const getTargetId = (e: TEdge): string =>
    typeof e.target === 'object' && e.target !== null && 'id' in e.target
      ? String(e.target.id)
      : String(e.target);

  // 1. Filter nodes by nodeTypes (always keep root node)
  const candidateNodeMap = new Map<string, TNode>();
  for (const n of nodes) {
    const nType = n.node_type || 'unknown';
    if (filters.nodeTypes.size === 0 || filters.nodeTypes.has(nType) || n.id === rootId) {
      candidateNodeMap.set(n.id, n);
    }
  }

  // 2. Filter edges by relations and endpoints in candidateNodeMap
  const candidateEdges: TEdge[] = [];
  for (const e of edges) {
    const s = getSourceId(e);
    const t = getTargetId(e);
    if (!candidateNodeMap.has(s) || !candidateNodeMap.has(t)) {
      continue;
    }
    const rel = e.relation || (e.synthetic ? 'synthetic' : 'unknown');
    if (filters.relations.size === 0 || filters.relations.has(rel)) {
      candidateEdges.push(e);
    }
  }

  // 3. Recompute reachability from rootId by BFS up to maxHop
  const reachableNodeIds = new Set<string>();
  if (rootId && candidateNodeMap.has(rootId)) {
    const adj = new Map<string, string[]>();
    for (const id of candidateNodeMap.keys()) {
      adj.set(id, []);
    }

    for (const e of candidateEdges) {
      const s = getSourceId(e);
      const t = getTargetId(e);
      if (filters.direction === 'dependencies') {
        // source -> target
        adj.get(s)?.push(t);
      } else if (filters.direction === 'dependents') {
        // target -> source
        adj.get(t)?.push(s);
      } else {
        // both (undirected)
        adj.get(s)?.push(t);
        adj.get(t)?.push(s);
      }
    }

    const queue: Array<{ id: string; hop: number }> = [{ id: rootId, hop: 0 }];
    const visited = new Map<string, number>([[rootId, 0]]);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      reachableNodeIds.add(curr.id);

      if (curr.hop < filters.maxHop) {
        const neighbors = adj.get(curr.id) || [];
        for (const nbr of neighbors) {
          if (!visited.has(nbr)) {
            visited.set(nbr, curr.hop + 1);
            queue.push({ id: nbr, hop: curr.hop + 1 });
          }
        }
      }
    }
  } else {
    for (const id of candidateNodeMap.keys()) {
      reachableNodeIds.add(id);
    }
  }

  // Filter edges to those with both endpoints in reachableNodeIds
  let filteredEdges = candidateEdges.filter(
    (e) => reachableNodeIds.has(getSourceId(e)) && reachableNodeIds.has(getTargetId(e))
  );

  // Compute node degrees within filtered edges
  const edgeDegrees = new Map<string, number>();
  for (const e of filteredEdges) {
    const s = getSourceId(e);
    const t = getTargetId(e);
    edgeDegrees.set(s, (edgeDegrees.get(s) || 0) + 1);
    edgeDegrees.set(t, (edgeDegrees.get(t) || 0) + 1);
  }

  // 4. Handle hideOrphans
  let filteredNodes = nodes.filter((n) => {
    if (!reachableNodeIds.has(n.id)) return false;
    if (filters.hideOrphans) {
      const deg = edgeDegrees.get(n.id) || 0;
      if (deg === 0 && n.id !== rootId) {
        return false;
      }
    }
    return true;
  });

  // Re-filter edges if any orphan nodes were removed
  const finalNodeSet = new Set(filteredNodes.map((n) => n.id));
  filteredEdges = filteredEdges.filter(
    (e) => finalNodeSet.has(getSourceId(e)) && finalNodeSet.has(getTargetId(e))
  );

  // 5. Truncate if > 300 nodes remain
  let truncated = false;
  if (filteredNodes.length > 300) {
    truncated = true;
    // Recompute total degree
    const currentDegrees = new Map<string, number>();
    for (const e of filteredEdges) {
      const s = getSourceId(e);
      const t = getTargetId(e);
      currentDegrees.set(s, (currentDegrees.get(s) || 0) + 1);
      currentDegrees.set(t, (currentDegrees.get(t) || 0) + 1);
    }

    // Always sort with rootId prioritized, then highest connectivity
    filteredNodes.sort((a, b) => {
      if (a.id === rootId) return -1;
      if (b.id === rootId) return 1;
      const degA = currentDegrees.get(a.id) || 0;
      const degB = currentDegrees.get(b.id) || 0;
      return degB - degA;
    });

    filteredNodes = filteredNodes.slice(0, 300);
    const top300Set = new Set(filteredNodes.map((n) => n.id));
    filteredEdges = filteredEdges.filter(
      (e) => top300Set.has(getSourceId(e)) && top300Set.has(getTargetId(e))
    );
  }

  return { nodes: filteredNodes, edges: filteredEdges, truncated };
}
