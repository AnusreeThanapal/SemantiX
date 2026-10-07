"""Repository pattern Data Access Layer (DAL) for SemantiX."""

import json
import logging
from typing import List, Optional, Dict, Any
from datetime import datetime

from semantix.models import Commit, ChangedFile, ChangeRecord, ImpactSubgraph, Explanation, HotspotItem, AnalysisJob
from semantix.storage.db import get_db_connection, init_db

logger = logging.getLogger("semantix.storage.repository")


class SQLiteRepository:
    """Isolated repository pattern implementation for SQLite storage."""

    def __init__(self, db_path: str = "semantix.db"):
        self.db_path = db_path
        init_db(self.db_path)

    def _get_conn(self):
        return get_db_connection(self.db_path)

    # 1. Job Management
    def save_job(self, job: AnalysisJob):
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute(
            """INSERT OR REPLACE INTO jobs (job_id, status, created_at, completed_at, error)
               VALUES (?, ?, ?, ?, ?)""",
            (job.job_id, job.status, job.created_at, job.completed_at, job.error),
        )
        conn.commit()
        conn.close()

    def get_job(self, job_id: str) -> Optional[AnalysisJob]:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return AnalysisJob(
                job_id=row["job_id"],
                status=row["status"],
                created_at=row["created_at"],
                completed_at=row["completed_at"],
                error=row["error"],
            )
        return None

    # 2. Commits & Changed Files
    def save_commit(self, commit: Commit):
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT OR REPLACE INTO commits (sha, author, timestamp, message) VALUES (?, ?, ?, ?)",
            (commit.sha, commit.author, commit.timestamp, commit.message),
        )
        for cf in commit.changed_files:
            cursor.execute(
                """INSERT INTO changed_files (commit_sha, file_path, change_type, old_content, new_content)
                   VALUES (?, ?, ?, ?, ?)""",
                (commit.sha, cf.file_path, cf.change_type, cf.old_content, cf.new_content),
            )
        conn.commit()
        conn.close()

    def get_commits_paginated(self, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        """Fetch commits joined with dominant change_type and risk_level."""
        conn = self._get_conn()
        cursor = conn.cursor()
        query = """
            SELECT 
                c.sha, 
                c.author, 
                c.timestamp, 
                c.message,
                COALESCE(cr.change_type, 'unknown') as change_type,
                COALESCE(e.risk_level, 'low') as risk_level
            FROM commits c
            LEFT JOIN change_records cr ON c.sha = cr.commit_sha
            LEFT JOIN explanations e ON c.sha = e.commit_sha
            GROUP BY c.sha
            ORDER BY c.timestamp DESC
            LIMIT ? OFFSET ?
        """
        cursor.execute(query, (limit, offset))
        rows = cursor.fetchall()
        conn.close()

        result = []
        for r in rows:
            result.append({
                "sha": r["sha"],
                "author": r["author"],
                "timestamp": r["timestamp"],
                "message": r["message"],
                "change_type": r["change_type"],
                "risk_level": r["risk_level"],
            })
        return result

    # 3. Change Records
    def save_change_records(self, records: List[ChangeRecord]):
        conn = self._get_conn()
        cursor = conn.cursor()
        for r in records:
            cursor.execute(
                """INSERT INTO change_records (commit_sha, file, change_type, confidence, ast_edit_summary, embedding_similarity)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (r.commit_sha, r.file, r.change_type, r.confidence, r.ast_edit_summary, r.embedding_similarity),
            )
        conn.commit()
        conn.close()

    def get_change_records_for_commit(self, commit_sha: str) -> List[ChangeRecord]:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM change_records WHERE commit_sha = ?", (commit_sha,))
        rows = cursor.fetchall()
        conn.close()
        return [
            ChangeRecord(
                commit_sha=r["commit_sha"],
                file=r["file"],
                change_type=r["change_type"],
                confidence=r["confidence"],
                ast_edit_summary=r["ast_edit_summary"],
                embedding_similarity=r["embedding_similarity"],
            )
            for r in rows
        ]

    # 4. Impact Subgraph
    def save_impact_subgraph(self, commit_sha: str, subgraph: ImpactSubgraph, file_path: Optional[str] = None):
        conn = self._get_conn()
        cursor = conn.cursor()
        f_path = file_path or subgraph.file_path or ""
        cursor.execute(
            """INSERT OR REPLACE INTO impact_subgraphs (commit_sha, file_path, changed_node, direct_impacts, transitive_impacts)
               VALUES (?, ?, ?, ?, ?)""",
            (
                commit_sha,
                f_path,
                subgraph.changed_node,
                json.dumps(subgraph.direct_impacts),
                json.dumps(subgraph.transitive_impacts),
            ),
        )
        conn.commit()
        conn.close()

    def get_impact_subgraphs_for_commit(self, commit_sha: str, file_path: Optional[str] = None) -> List[ImpactSubgraph]:
        conn = self._get_conn()
        cursor = conn.cursor()
        if file_path is not None:
            cursor.execute("SELECT * FROM impact_subgraphs WHERE commit_sha = ? AND file_path = ?", (commit_sha, file_path))
        else:
            cursor.execute("SELECT * FROM impact_subgraphs WHERE commit_sha = ?", (commit_sha,))
        rows = cursor.fetchall()
        conn.close()
        return [
            ImpactSubgraph(
                commit_sha=r["commit_sha"],
                file_path=r["file_path"],
                changed_node=r["changed_node"],
                direct_impacts=json.loads(r["direct_impacts"]),
                transitive_impacts=json.loads(r["transitive_impacts"]),
            )
            for r in rows
        ]

    def get_impact_subgraph_for_commit(self, commit_sha: str, file_path: Optional[str] = None) -> Optional[ImpactSubgraph]:
        subgraphs = self.get_impact_subgraphs_for_commit(commit_sha, file_path=file_path)
        return subgraphs[0] if subgraphs else None

    # 5. Explanations
    def save_explanation(self, explanation: Explanation, file_path: Optional[str] = None):
        conn = self._get_conn()
        cursor = conn.cursor()
        f_path = file_path or explanation.file_path or ""
        cursor.execute(
            """INSERT OR REPLACE INTO explanations (commit_sha, file_path, summary, why_it_matters, affected_count, risk_level)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                explanation.commit_sha,
                f_path,
                explanation.summary,
                explanation.why_it_matters,
                explanation.affected_count,
                explanation.risk_level,
            ),
        )
        conn.commit()
        conn.close()

    def get_explanations_for_commit(self, commit_sha: str, file_path: Optional[str] = None) -> List[Explanation]:
        conn = self._get_conn()
        cursor = conn.cursor()
        if file_path is not None:
            cursor.execute("SELECT * FROM explanations WHERE commit_sha = ? AND file_path = ?", (commit_sha, file_path))
        else:
            cursor.execute("SELECT * FROM explanations WHERE commit_sha = ?", (commit_sha,))
        rows = cursor.fetchall()
        conn.close()
        return [
            Explanation(
                commit_sha=r["commit_sha"],
                file_path=r["file_path"],
                summary=r["summary"],
                why_it_matters=r["why_it_matters"],
                affected_count=r["affected_count"],
                risk_level=r["risk_level"],
            )
            for r in rows
        ]

    def get_explanation_for_commit(self, commit_sha: str, file_path: Optional[str] = None) -> Optional[Explanation]:
        explanations = self.get_explanations_for_commit(commit_sha, file_path=file_path)
        return explanations[0] if explanations else None

    # 6. Hotspots
    def get_hotspots(self, limit: int = 10) -> List[HotspotItem]:
        """Rank modules/files by semantic churn count (logic_change and api_change events)."""
        conn = self._get_conn()
        cursor = conn.cursor()
        query = """
            SELECT file as module, COUNT(*) as churn_count
            FROM change_records
            WHERE change_type IN ('logic_change', 'api_change')
            GROUP BY file
            ORDER BY churn_count DESC
            LIMIT ?
        """
        cursor.execute(query, (limit,))
        rows = cursor.fetchall()
        conn.close()
        return [HotspotItem(module=r["module"], semantic_churn_count=r["churn_count"]) for r in rows]

    # 7. Embedding Cache
    def get_cached_embedding(self, content_hash: str) -> Optional[List[float]]:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT embedding_json FROM embeddings_cache WHERE content_hash = ?", (content_hash,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return json.loads(row["embedding_json"])
        return None

    def save_cached_embedding(self, content_hash: str, vec: List[float]):
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT OR REPLACE INTO embeddings_cache (content_hash, embedding_json) VALUES (?, ?)",
            (content_hash, json.dumps(vec)),
        )
        conn.commit()
        conn.close()
