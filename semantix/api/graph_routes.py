import os
import collections
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query

from semantix.storage import SQLiteRepository
from semantix.storage.db import get_db_connection
from semantix.graph_insights.snapshot import get_snapshot

router = APIRouter()


def _db_path(job_id: Optional[str] = None, sha: Optional[str] = None) -> str:
    base_db = os.getenv("SEMANTIX_DB_PATH", "semantix.db")
    if job_id:
        repo = SQLiteRepository(base_db)
        analysis_db = repo.get_analysis_database_path(job_id)
        if analysis_db and os.path.isfile(analysis_db):
            return analysis_db

    if os.path.isfile(base_db):
        try:
            conn = get_db_connection(base_db)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='impact_subgraphs'")
            if cursor.fetchone():
                if sha:
                    cursor.execute("SELECT 1 FROM impact_subgraphs WHERE commit_sha = ? LIMIT 1", (sha,))
                    if cursor.fetchone():
                        conn.close()
                        return base_db
                else:
                    conn.close()
                    return base_db

            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='analysis_databases'")
            if cursor.fetchone():
                cursor.execute("SELECT db_path FROM analysis_databases ORDER BY rowid DESC")
                rows = cursor.fetchall()
                conn.close()
                for r in rows:
                    candidate = r["db_path"]
                    if os.path.isfile(candidate):
                        if sha:
                            c_conn = get_db_connection(candidate)
                            c_cur = c_conn.cursor()
                            c_cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='impact_subgraphs'")
                            if c_cur.fetchone():
                                c_cur.execute("SELECT 1 FROM impact_subgraphs WHERE commit_sha = ? LIMIT 1", (sha,))
                                found = c_cur.fetchone()
                                c_conn.close()
                                if found:
                                    return candidate
                            else:
                                c_conn.close()
                        else:
                            return candidate
            else:
                conn.close()
        except Exception:
            pass

    return base_db


@router.get("/commits/{sha}/impact/detailed")
def get_detailed_impact(
    sha: str,
    hops: int = Query(3, ge=1, le=3),
    job_id: Optional[str] = Query(None),
) -> Dict[str, Any]:
    db_path = _db_path(job_id=job_id, sha=sha)
    repo = SQLiteRepository(db_path)
    impact = repo.get_impact_subgraph_for_commit(sha)
    if not impact:
        raise HTTPException(status_code=404, detail="Impact subgraph not found for commit SHA")

    changed_node = impact.changed_node
    direct_impacts = impact.direct_impacts or []
    transitive_impacts = impact.transitive_impacts or []

    candidate_nodes: List[str] = []
    seen = set()
    for n in [changed_node] + list(direct_impacts) + list(transitive_impacts):
        if n and n not in seen:
            seen.add(n)
            candidate_nodes.append(n)

    graph, _ = get_snapshot(db_path)
    warnings: List[str] = []

    distances: Dict[str, int] = {}
    if graph.has_node(changed_node):
        distances[changed_node] = 0
        queue = collections.deque([changed_node])
        while queue:
            curr = queue.popleft()
            curr_dist = distances[curr]
            nbrs = set(graph.predecessors(curr)) | set(graph.successors(curr))
            for nbr in nbrs:
                if nbr not in distances:
                    distances[nbr] = curr_dist + 1
                    queue.append(nbr)
    else:
        warnings.append(f"Changed node '{changed_node}' is missing from the dependency graph")

    direct_set = set(direct_impacts)
    node_hops: Dict[str, int] = {}
    for n in candidate_nodes:
        if n == changed_node:
            node_hops[n] = 0
        elif n in distances:
            node_hops[n] = distances[n]
        else:
            assigned = 1 if n in direct_set else 2
            node_hops[n] = assigned
            warnings.append(
                f"Node '{n}' is missing or unreachable from changed node '{changed_node}'; assigned hop={assigned}"
            )

    kept_node_ids = [n for n in candidate_nodes if node_hops[n] <= hops]
    kept_node_set = set(kept_node_ids)

    edges: List[Dict[str, Any]] = []
    real_edges_count = 0
    for u, v, data in graph.edges(data=True):
        if u in kept_node_set and v in kept_node_set:
            real_edges_count += 1
            if len(edges) < 2000:
                edges.append({
                    "source": u,
                    "target": v,
                    "relation": data.get("relation", "unknown"),
                    "synthetic": False,
                })

    if real_edges_count > 2000:
        warnings.append(f"Edge count exceeded limit of 2000 ({real_edges_count} total); truncated to 2000")

    connected_nodes = set()
    for e in edges:
        connected_nodes.add(e["source"])
        connected_nodes.add(e["target"])

    for n in kept_node_ids:
        if n != changed_node and n not in connected_nodes:
            edges.append({
                "source": n,
                "target": changed_node,
                "relation": "synthetic",
                "synthetic": True,
            })
            connected_nodes.add(n)
            connected_nodes.add(changed_node)

    if changed_node in kept_node_set and changed_node not in connected_nodes and len(kept_node_ids) > 1:
        other = next(n for n in kept_node_ids if n != changed_node)
        edges.append({
            "source": other,
            "target": changed_node,
            "relation": "synthetic",
            "synthetic": True,
        })
        connected_nodes.add(changed_node)

    in_degrees: Dict[str, int] = collections.defaultdict(int)
    out_degrees: Dict[str, int] = collections.defaultdict(int)
    for e in edges:
        out_degrees[e["source"]] += 1
        in_degrees[e["target"]] += 1

    nodes_list: List[Dict[str, Any]] = []
    for n in kept_node_ids:
        if ":" in n:
            label = n.split(":")[-1]
        else:
            clean_path = n.replace("\\", "/")
            label = os.path.basename(clean_path) or n

        node_data = graph.nodes[n] if graph.has_node(n) else {}
        node_type = node_data.get("node_type", "unknown")

        if "file" in node_data and node_data["file"]:
            file_val = node_data["file"]
        elif ":" in n:
            file_val = n.split(":", 1)[0]
        else:
            file_val = n

        nodes_list.append({
            "id": n,
            "label": label,
            "node_type": node_type,
            "file": file_val,
            "hop": node_hops[n],
            "in_degree": in_degrees[n],
            "out_degree": out_degrees[n],
        })

    direct_count = sum(1 for item in nodes_list if item["hop"] == 1)
    transitive_count = sum(1 for item in nodes_list if item["hop"] > 1)
    max_hop_val = max((item["hop"] for item in nodes_list), default=0)
    unique_files = len(set(item["file"] for item in nodes_list if item["file"]))
    top_hub = None
    if nodes_list:
        top_hub = max(nodes_list, key=lambda item: item["in_degree"] + item["out_degree"])["id"]

    stats = {
        "nodes": len(nodes_list),
        "edges": len(edges),
        "direct": direct_count,
        "transitive": transitive_count,
        "max_hop": max_hop_val,
        "files_affected": unique_files,
        "top_hub": top_hub,
    }

    return {
        "commit_sha": sha,
        "changed_node": changed_node,
        "hop_limit": hops,
        "nodes": nodes_list,
        "edges": edges,
        "stats": stats,
        "warnings": warnings,
    }


import time
from semantix.codebert.service import get_codebert_service
from semantix.codebert.analysis import (
    symbol_source,
    get_or_compute_embedding,
    centred_cosine_scores,
    compute_drift,
    find_latent_dependencies,
)


@router.get("/codebert/status")
def get_codebert_status() -> Dict[str, Any]:
    service = get_codebert_service()
    return service.status()


@router.post("/codebert/warmup")
def warmup_codebert() -> Dict[str, Any]:
    service = get_codebert_service()
    service.warmup()
    return service.status()


@router.get("/commits/{sha}/impact/codebert")
def get_commit_codebert_impact(
    sha: str,
    hops: int = Query(3, ge=1, le=3),
    latent_k: int = Query(8, ge=1, le=50),
    job_id: Optional[str] = Query(None),
) -> Dict[str, Any]:
    service = get_codebert_service()
    st = service.status()
    state = st["state"]
    engine_info = {
        "name": st["model_name"],
        "kind": st["kind"],
        "device": st["device"],
        "dim": st["dim"],
    }

    if state == "unloaded":
        service.warmup()
        return {
            "commit_sha": sha,
            "status": "loading",
            "engine": engine_info,
            "node_scores": {},
            "drift": [],
            "latent_dependencies": [],
            "warnings": ["CodeBERT model loading initiated"],
            "timings_ms": {"total": 0},
        }

    if state == "loading":
        return {
            "commit_sha": sha,
            "status": "loading",
            "engine": engine_info,
            "node_scores": {},
            "drift": [],
            "latent_dependencies": [],
            "warnings": ["CodeBERT model is currently loading"],
            "timings_ms": {"total": 0},
        }

    if state in ("disabled", "error"):
        return {
            "commit_sha": sha,
            "status": state,
            "message": st["message"],
            "engine": engine_info,
            "node_scores": {},
            "drift": [],
            "latent_dependencies": [],
            "warnings": [st["message"] or f"CodeBERT service in {state} state"],
            "timings_ms": {"total": 0},
        }

    t0 = time.time()
    db_path = _db_path(job_id=job_id, sha=sha)
    repo = SQLiteRepository(db_path)
    impact = repo.get_impact_subgraph_for_commit(sha)
    if not impact:
        raise HTTPException(status_code=404, detail="Impact subgraph not found for commit SHA")

    changed_node = impact.changed_node
    direct_impacts = impact.direct_impacts or []
    transitive_impacts = impact.transitive_impacts or []

    candidate_nodes = []
    seen = set()
    for n in [changed_node] + list(direct_impacts) + list(transitive_impacts):
        if n and n not in seen:
            seen.add(n)
            candidate_nodes.append(n)

    graph, file_contents = get_snapshot(db_path)
    warnings: List[str] = []

    distances: Dict[str, int] = {}
    if graph.has_node(changed_node):
        distances[changed_node] = 0
        queue = collections.deque([changed_node])
        while queue:
            curr = queue.popleft()
            curr_dist = distances[curr]
            nbrs = set(graph.predecessors(curr)) | set(graph.successors(curr))
            for nbr in nbrs:
                if nbr not in distances:
                    distances[nbr] = curr_dist + 1
                    queue.append(nbr)

    direct_set = set(direct_impacts)
    node_hops: Dict[str, int] = {}
    for n in candidate_nodes:
        if n == changed_node:
            node_hops[n] = 0
        elif n in distances:
            node_hops[n] = distances[n]
        else:
            node_hops[n] = 1 if n in direct_set else 2

    kept_nodes = [n for n in candidate_nodes if node_hops[n] <= hops]
    impact_node_set = set(kept_nodes)

    node_scores: Dict[str, Any] = {}
    changed_type = graph.nodes[changed_node].get("node_type", "unknown") if graph.has_node(changed_node) else "unknown"
    changed_src = symbol_source(changed_node, changed_type, file_contents)

    cands_to_score = []
    cand_sources = []
    for n in kept_nodes:
        if n == changed_node:
            node_scores[n] = {"semantic_score": 1.0, "percentile": 1.0}
        else:
            ntype = graph.nodes[n].get("node_type", "unknown") if graph.has_node(n) else "unknown"
            src = symbol_source(n, ntype, file_contents)
            if src and changed_src:
                cands_to_score.append(n)
                cand_sources.append(src)
            else:
                node_scores[n] = {"semantic_score": None, "percentile": None}

    if changed_src and cands_to_score:
        query_vec = get_or_compute_embedding(repo, changed_src, embedder=service)
        cand_vecs = [get_or_compute_embedding(repo, src, embedder=service) for src in cand_sources]
        scores, percentiles = centred_cosine_scores(query_vec, cand_vecs)
        for i, c_id in enumerate(cands_to_score):
            node_scores[c_id] = {
                "semantic_score": scores[i],
                "percentile": percentiles[i],
            }

    drift_list: List[Dict[str, Any]] = []
    try:
        conn = get_db_connection(db_path)
        cur = conn.cursor()
        cur.execute(
            "SELECT file_path, old_content, new_content FROM changed_files WHERE commit_sha = ? LIMIT 10",
            (sha,),
        )
        cf_rows = cur.fetchall()
        conn.close()
        for r in cf_rows:
            d = compute_drift(r["file_path"], r["old_content"], r["new_content"], embedder=service)
            drift_list.append(d)
    except Exception as exc:
        warnings.append(f"Could not compute drift: {exc}")

    latent_deps = find_latent_dependencies(
        graph,
        impact_node_set,
        changed_node,
        file_contents,
        repo=repo,
        latent_k=latent_k,
        embedder=service,
    )

    total_ms = int(round((time.time() - t0) * 1000))

    return {
        "commit_sha": sha,
        "status": state,
        "engine": engine_info,
        "node_scores": node_scores,
        "drift": drift_list,
        "latent_dependencies": latent_deps,
        "warnings": warnings,
        "timings_ms": {"total": total_ms},
    }
