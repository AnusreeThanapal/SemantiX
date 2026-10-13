import ast
import math
import hashlib
from typing import Dict, List, Tuple, Any, Optional
import networkx as nx

from semantix.codebert.service import get_codebert_service


def centred_cosine_scores(
    query_vec: List[float], candidate_vecs: List[List[float]]
) -> Tuple[List[float], List[float]]:
    """Mean-centres candidate matrix, re-normalises, computes cosine, rescales to 0..1, and calculates percentile ranks."""
    if not candidate_vecs:
        return [], []

    num_cands = len(candidate_vecs)
    dim = len(query_vec)

    # 1. Compute mean vector of candidate embeddings
    mean_vec = [sum(cand[i] for cand in candidate_vecs) / num_cands for i in range(dim)]

    # 2. Centre and L2-normalise candidates
    centered_cands: List[List[float]] = []
    for cand in candidate_vecs:
        diff = [cand[i] - mean_vec[i] for i in range(dim)]
        norm = math.sqrt(sum(x * x for x in diff))
        if norm > 0:
            centered_cands.append([x / norm for x in diff])
        else:
            centered_cands.append(cand)

    # 3. Centre and L2-normalise query vector
    q_diff = [query_vec[i] - mean_vec[i] for i in range(dim)]
    q_norm = math.sqrt(sum(x * x for x in q_diff))
    if q_norm > 0:
        q_centered = [x / q_norm for x in q_diff]
    else:
        q_centered = query_vec

    # 4. Compute cosine and rescale to 0..1
    scores: List[float] = []
    for c in centered_cands:
        raw_cos = sum(q_centered[i] * c[i] for i in range(dim))
        rescaled = max(0.0, min(1.0, (raw_cos + 1.0) / 2.0))
        scores.append(round(rescaled, 4))

    # 5. Percentile rank (0..1)
    percentiles: List[float] = []
    for s in scores:
        pct = sum(1 for item in scores if item <= s) / num_cands
        percentiles.append(round(pct, 4))

    return scores, percentiles


def symbol_source(node: str, node_type: str, file_contents: Dict[str, str]) -> Optional[str]:
    """Extracts source code for file, function, or class nodes; returns None for other types."""
    if node_type == "file":
        return file_contents.get(node)

    if node_type in ("function", "class"):
        if ":" not in node:
            return None
        file_path, symbol_name = node.split(":", 1)
        code = file_contents.get(file_path)
        if not code:
            return None

        # Python source segment extraction
        if file_path.endswith((".py", ".pyw")):
            try:
                tree = ast.parse(code)
                for item in ast.walk(tree):
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                        if item.name == symbol_name:
                            segment = ast.get_source_segment(code, item)
                            if segment:
                                return segment
            except Exception:
                pass
            return None

        # JavaScript / TypeScript-like source segment extraction
        if file_path.endswith((".js", ".jsx", ".mjs", ".cjs")):
            try:
                from semantix.semantic_diff.parser import parse_code
                tree = parse_code(code, file_path)
                if tree and tree.root_node:
                    def _find_symbol(n):
                        if n.type in ("function_declaration", "class_declaration", "method_definition"):
                            name_node = n.child_by_field_name("name")
                            if name_node and name_node.text:
                                if name_node.text.decode("utf-8") == symbol_name:
                                    return code.encode("utf-8")[n.start_byte:n.end_byte].decode("utf-8")
                        for child in n.children:
                            res = _find_symbol(child)
                            if res is not None:
                                return res
                        return None
                    return _find_symbol(tree.root_node)
            except Exception:
                pass
            return None

    return None


def get_or_compute_embedding(repo, text: str, embedder=None) -> List[float]:
    """Retrieves cached embedding or generates and caches a new embedding."""
    if embedder is None:
        embedder = get_codebert_service()
    model = embedder.status().get("model_name", "codebert")
    text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
    cache_key = f"codebert::{model}::{text_hash}"

    if repo:
        try:
            cached = repo.get_cached_embedding(cache_key)
            if cached:
                return cached
        except Exception:
            pass

    vec = embedder.embed([text])[0]

    if repo:
        try:
            repo.save_cached_embedding(cache_key, vec)
        except Exception:
            pass

    return vec


def compute_drift(file: str, old: Optional[str], new: Optional[str], embedder=None) -> Dict[str, Any]:
    """Computes semantic drift between old and new file content."""
    if old is None or new is None:
        return {"file": file, "cosine": None, "drift": None, "level": "n/a"}

    if embedder is None:
        embedder = get_codebert_service()

    v_old = embedder.embed_long_text(old)
    v_new = embedder.embed_long_text(new)

    cosine = sum(v_old[i] * v_new[i] for i in range(len(v_old)))
    cosine = max(-1.0, min(1.0, cosine))
    drift_val = round(1.0 - cosine, 4)

    is_fallback = embedder.status().get("kind") == "fallback-heuristic"

    result: Dict[str, Any] = {
        "file": file,
        "cosine": round(cosine, 4),
        "drift": drift_val,
    }

    if not is_fallback:
        if drift_val < 0.01:
            result["level"] = "low"
        elif drift_val < 0.05:
            result["level"] = "moderate"
        else:
            result["level"] = "high"

    return result


def find_latent_dependencies(
    graph: nx.DiGraph,
    impact_node_set: set,
    changed_node: str,
    file_contents: Dict[str, str],
    repo=None,
    latent_k: int = 8,
    embedder=None,
) -> List[Dict[str, Any]]:
    """Identifies latent dependencies among function/class nodes outside the impact subgraph."""
    if embedder is None:
        embedder = get_codebert_service()

    # Query node source
    changed_type = graph.nodes[changed_node].get("node_type", "unknown") if graph.has_node(changed_node) else "unknown"
    query_src = symbol_source(changed_node, changed_type, file_contents)
    if not query_src:
        return []

    # Filter candidate nodes: function/class not in impact set
    candidates = []
    for n, data in graph.nodes(data=True):
        if n in impact_node_set:
            continue
        ntype = data.get("node_type", "unknown")
        if ntype in ("function", "class"):
            candidates.append(n)

    if not candidates:
        return []

    # Keep top 300 by degree
    if len(candidates) > 300:
        candidates.sort(key=lambda n: graph.in_degree(n) + graph.out_degree(n), reverse=True)
        candidates = candidates[:300]

    # Extract source for candidates
    valid_cands = []
    cand_sources = []
    for c in candidates:
        ntype = graph.nodes[c].get("node_type", "unknown")
        src = symbol_source(c, ntype, file_contents)
        if src:
            valid_cands.append(c)
            cand_sources.append(src)

    if not valid_cands:
        return []

    # Embed query and candidates
    query_vec = get_or_compute_embedding(repo, query_src, embedder=embedder)
    cand_vecs = [get_or_compute_embedding(repo, src, embedder=embedder) for src in cand_sources]

    # Compute scores and percentiles
    scores, percentiles = centred_cosine_scores(query_vec, cand_vecs)

    # Filter: score >= 0.5 and percentile >= 0.9
    matched: List[Dict[str, Any]] = []
    for i, c in enumerate(valid_cands):
        sc = scores[i]
        pct = percentiles[i]
        if sc >= 0.5 and pct >= 0.9:
            c_data = graph.nodes[c]
            label = c.split(":")[-1] if ":" in c else c
            matched.append({
                "id": c,
                "label": label,
                "file": c_data.get("file", c.split(":", 1)[0] if ":" in c else c),
                "node_type": c_data.get("node_type", "unknown"),
                "score": sc,
                "percentile": pct,
            })

    matched.sort(key=lambda item: item["score"], reverse=True)
    return matched[:latent_k]
