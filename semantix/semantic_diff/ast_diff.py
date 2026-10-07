"""GumTree-style structural AST diffing engine."""

import logging
from typing import Dict, List, Any, Optional, Tuple, Set
import tree_sitter

logger = logging.getLogger("semantix.semantic_diff.ast_diff")


class ASTNode:
    """Simplified AST node representation for structural diffing."""
    def __init__(self, node_id: int, type_name: str, text: str, start_byte: int, end_byte: int):
        self.node_id = node_id
        self.type_name = type_name
        self.text = text
        self.start_byte = start_byte
        self.end_byte = end_byte
        self.children: List["ASTNode"] = []
        self.parent: Optional["ASTNode"] = None

    @property
    def label(self) -> str:
        return f"{self.type_name}:{self.text}"

    def __repr__(self):
        return f"ASTNode({self.node_id}, {self.type_name}, '{self.text[:20]}')"


class ASTDiffEngine:
    """Performs structural GumTree-inspired node matching between two ASTs."""

    def __init__(self):
        self._next_id = 0

    def build_tree(self, ts_node: tree_sitter.Node, source_bytes: bytes) -> ASTNode:
        self._next_id += 1
        text = source_bytes[ts_node.start_byte:ts_node.end_byte].decode("utf-8", errors="ignore").strip()
        # Keep short labels for non-named or short leaf nodes to avoid memory bloat
        if len(text) > 100:
            text = text[:100] + "..."
        
        ast_node = ASTNode(
            node_id=self._next_id,
            type_name=ts_node.type,
            text=text,
            start_byte=ts_node.start_byte,
            end_byte=ts_node.end_byte,
        )

        for child in ts_node.children:
            child_ast = self.build_tree(child, source_bytes)
            child_ast.parent = ast_node
            ast_node.children.append(child_ast)

        return ast_node

    def diff(
        self, old_tree: Optional[tree_sitter.Tree], new_tree: Optional[tree_sitter.Tree], old_code: str, new_code: str
    ) -> Dict[str, Any]:
        """Compute structural edit script between old and new ASTs."""
        if not old_tree and not new_tree:
            return {
                "edit_script": [],
                "counts": {"inserted": 0, "deleted": 0, "updated": 0, "moved": 0, "unchanged": 0},
                "summary": "No AST available for both files.",
            }

        if not old_tree:
            new_root = self.build_tree(new_tree.root_node, new_code.encode("utf-8"))
            all_new = self._flatten(new_root)
            return {
                "edit_script": ["inserted_all"],
                "counts": {"inserted": len(all_new), "deleted": 0, "updated": 0, "moved": 0, "unchanged": 0},
                "summary": f"File created with {len(all_new)} AST nodes.",
            }

        if not new_tree:
            old_root = self.build_tree(old_tree.root_node, old_code.encode("utf-8"))
            all_old = self._flatten(old_root)
            return {
                "edit_script": ["deleted_all"],
                "counts": {"inserted": 0, "deleted": len(all_old), "updated": 0, "moved": 0, "unchanged": 0},
                "summary": f"File deleted with {len(all_old)} AST nodes.",
            }

        old_root = self.build_tree(old_tree.root_node, old_code.encode("utf-8"))
        new_root = self.build_tree(new_tree.root_node, new_code.encode("utf-8"))

        old_nodes = self._flatten(old_root)
        new_nodes = self._flatten(new_root)

        matched_pairs: Set[Tuple[int, int]] = set()
        matched_old_ids: Set[int] = set()
        matched_new_ids: Set[int] = set()

        # Top-Down Phase: Exact label/type/text matching
        old_by_label: Dict[str, List[ASTNode]] = {}
        for n in old_nodes:
            old_by_label.setdefault(n.label, []).append(n)

        for n in new_nodes:
            if n.label in old_by_label and old_by_label[n.label]:
                candidate = old_by_label[n.label].pop(0)
                matched_pairs.add((candidate.node_id, n.node_id))
                matched_old_ids.add(candidate.node_id)
                matched_new_ids.add(n.node_id)

        # Bottom-Up Phase: Match remaining unmatched nodes of same type_name
        unmatched_old = [n for n in old_nodes if n.node_id not in matched_old_ids]
        unmatched_new = [n for n in new_nodes if n.node_id not in matched_new_ids]

        old_by_type: Dict[str, List[ASTNode]] = {}
        for n in unmatched_old:
            old_by_type.setdefault(n.type_name, []).append(n)

        updated_count = 0
        for n in unmatched_new:
            if n.type_name in old_by_type and old_by_type[n.type_name]:
                candidate = old_by_type[n.type_name].pop(0)
                matched_pairs.add((candidate.node_id, n.node_id))
                matched_old_ids.add(candidate.node_id)
                matched_new_ids.add(n.node_id)
                updated_count += 1

        deleted_count = len(old_nodes) - len(matched_old_ids)
        inserted_count = len(new_nodes) - len(matched_new_ids)
        unchanged_count = len(matched_pairs) - updated_count

        summary_str = f"AST diff: {inserted_count} inserted, {deleted_count} deleted, {updated_count} updated, {unchanged_count} unchanged"

        return {
            "edit_script": [f"matched:{len(matched_pairs)}", f"inserted:{inserted_count}", f"deleted:{deleted_count}"],
            "counts": {
                "inserted": inserted_count,
                "deleted": deleted_count,
                "updated": updated_count,
                "moved": 0,
                "unchanged": unchanged_count,
            },
            "summary": summary_str,
        }

    def _flatten(self, root: ASTNode) -> List[ASTNode]:
        nodes = [root]
        for child in root.children:
            nodes.extend(self._flatten(child))
        return nodes
