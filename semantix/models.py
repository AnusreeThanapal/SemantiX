"""Domain models for SemantiX."""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class ChangedFile(BaseModel):
    file_path: str
    change_type: str  # 'added', 'modified', 'deleted', 'renamed'
    old_content: Optional[str] = None
    new_content: Optional[str] = None


class Commit(BaseModel):
    sha: str
    author: str
    timestamp: str
    message: str
    changed_files: List[ChangedFile] = Field(default_factory=list)


class ChangeRecord(BaseModel):
    commit_sha: str
    file: str
    change_type: str  # 'rename', 'formatting/cosmetic', 'refactor', 'logic_change', 'api_change', 'bug_fix_pattern', 'unknown'
    confidence: float
    ast_edit_summary: str
    embedding_similarity: Optional[float] = None


class ImpactSubgraph(BaseModel):
    commit_sha: Optional[str] = None
    file_path: Optional[str] = None
    changed_node: str
    direct_impacts: List[str] = Field(default_factory=list)
    transitive_impacts: List[str] = Field(default_factory=list)


class Explanation(BaseModel):
    commit_sha: str
    file_path: Optional[str] = None
    summary: str
    why_it_matters: str
    affected_count: int
    risk_level: str  # 'low', 'medium', 'high', 'critical'


class HotspotItem(BaseModel):
    module: str
    semantic_churn_count: int


class AnalysisJob(BaseModel):
    job_id: str
    status: str  # 'pending', 'running', 'complete', 'failed'
    created_at: str
    completed_at: Optional[str] = None
    error: Optional[str] = None
