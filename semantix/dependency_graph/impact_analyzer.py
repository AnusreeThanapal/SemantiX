"""Impact propagation analyzer over static dependency graph."""

import logging
from typing import List, Set, Dict, Any, Optional
import networkx as nx
from semantix.models import ChangeRecord, ImpactSubgraph

logger = logging.getLogger("semantix.dependency_graph.impact_analyzer")


class ImpactAnalyzer:
    """Computes direct and transitive impacts for changed code nodes up to N hops."""

    def compute_impact(
        self, graph: nx.DiGraph, change_record: ChangeRecord, hop_limit: int = 3
    ) -> ImpactSubgraph:
        file_path = change_record.file

        # Locate target node in graph (match file or defined function within file)
        target_node = file_path
        if not graph.has_node(target_node):
            # Try finding any defined function node for this file
            matching_nodes = [n for n in graph.nodes if n.startswith(f"{file_path}:")]
            if matching_nodes:
                target_node = matching_nodes[0]
            else:
                # Add node dynamically if missing
                graph.add_node(target_node, node_type="file")

        logger.info(
            "Computing impact subgraph",
            extra={"commit_sha": change_record.commit_sha, "target_node": target_node, "hop_limit": hop_limit},
        )

        visited: Dict[str, int] = {target_node: 0}
        current_layer: Set[str] = {target_node}

        for hop in range(1, hop_limit + 1):
            next_layer: Set[str] = set()
            for node in current_layer:
                # Collect neighbors (both callers/dependents and defined symbols)
                neighbors = set(graph.predecessors(node)) | set(graph.successors(node))
                for neighbor in neighbors:
                    if neighbor not in visited:
                        visited[neighbor] = hop
                        next_layer.add(neighbor)
            current_layer = next_layer
            if not current_layer:
                break

        direct_impacts = [n for n, dist in visited.items() if dist == 1]
        transitive_impacts = [n for n, dist in visited.items() if dist > 1]

        return ImpactSubgraph(
            changed_node=target_node,
            direct_impacts=sorted(direct_impacts),
            transitive_impacts=sorted(transitive_impacts),
        )
