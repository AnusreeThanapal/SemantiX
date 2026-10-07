"""FastAPI REST API server for SemantiX."""

import os
import uuid
import logging
from datetime import datetime, UTC
from typing import List, Optional, Dict, Any, Union
from fastapi import FastAPI, BackgroundTasks, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


from semantix.models import ImpactSubgraph, Explanation, HotspotItem, AnalysisJob
from semantix.storage.repository import SQLiteRepository
from semantix.api.pipeline_runner import run_analysis_pipeline

logger = logging.getLogger("semantix.api")

app = FastAPI(
    title="SemantiX API",
    description="AI-augmented visual analytics platform for semantic software evolution and dependency impact analysis.",
    version="0.1.0",
)

# Enable CORS with configurable SEMANTIX_CORS_ORIGINS (default to local Vite dev server)
cors_origins_raw = os.getenv("SEMANTIX_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
cors_origins = [origin.strip() for origin in cors_origins_raw.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRepoRequest(BaseModel):
    repo_url_or_path: str = Field(..., description="Local directory path or Git clone URL")
    commit_depth: int = Field(100, ge=1, le=1000, description="Commit history depth to analyze")
    hop_limit: int = Field(3, ge=1, le=10, description="Dependency graph traversal hop limit")


class AnalyzeRepoResponse(BaseModel):
    job_id: str
    status: str


def get_repo() -> SQLiteRepository:
    db_path = os.getenv("SEMANTIX_DB_PATH", "semantix.db")
    return SQLiteRepository(db_path=db_path)



@app.get("/")
def read_root():
    return {"message": "SemantiX API Server", "version": "0.1.0"}


@app.post("/repos/analyze", response_model=AnalyzeRepoResponse, status_code=202)
def analyze_repo(req: AnalyzeRepoRequest, background_tasks: BackgroundTasks):
    """Kicks off full pipeline analysis as a background task and returns job_id."""
    job_id = str(uuid.uuid4())
    now_iso = datetime.now(UTC).isoformat()
    job = AnalysisJob(job_id=job_id, status="pending", created_at=now_iso)

    repository = get_repo()
    repository.save_job(job)

    background_tasks.add_task(
        run_analysis_pipeline,
        job_id=job_id,
        repo_url_or_path=req.repo_url_or_path,
        commit_depth=req.commit_depth,
        hop_limit=req.hop_limit,
        db_path=repository.db_path,
    )

    return AnalyzeRepoResponse(job_id=job_id, status="pending")


@app.get("/jobs/{job_id}", response_model=AnalysisJob)
def get_job_status(job_id: str):
    """Returns analysis job status (pending, running, complete, failed)."""
    repository = get_repo()
    job = repository.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/commits", response_model=List[Dict[str, Any]])
def list_commits(limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    """Returns paginated list of analyzed commits with change_type and risk_level."""
    repository = get_repo()
    return repository.get_commits_paginated(limit=limit, offset=offset)


@app.get("/commits/{sha}/impact", response_model=Union[ImpactSubgraph, List[ImpactSubgraph]])
def get_commit_impact(sha: str, file_path: Optional[str] = Query(None, description="Optional file path filter")):
    """Returns the ImpactSubgraph(s) for a specific commit SHA."""
    repository = get_repo()
    if file_path:
        impact = repository.get_impact_subgraph_for_commit(sha, file_path=file_path)
        if not impact:
            raise HTTPException(status_code=404, detail=f"Impact subgraph not found for commit SHA {sha} and file {file_path}")
        return impact

    subgraphs = repository.get_impact_subgraphs_for_commit(sha)
    if not subgraphs:
        raise HTTPException(status_code=404, detail="Impact subgraph not found for commit SHA")
    if len(subgraphs) == 1:
        return subgraphs[0]
    return subgraphs


@app.get("/commits/{sha}/explanation", response_model=Union[Explanation, List[Explanation]])
def get_commit_explanation(sha: str, file_path: Optional[str] = Query(None, description="Optional file path filter")):
    """Returns the stored Explanation(s) for a specific commit SHA."""
    repository = get_repo()
    if file_path:
        explanation = repository.get_explanation_for_commit(sha, file_path=file_path)
        if not explanation:
            raise HTTPException(status_code=404, detail=f"Explanation not found for commit SHA {sha} and file {file_path}")
        return explanation

    explanations = repository.get_explanations_for_commit(sha)
    if not explanations:
        raise HTTPException(status_code=404, detail="Explanation not found for commit SHA")
    if len(explanations) == 1:
        return explanations[0]
    return explanations


@app.get("/hotspots", response_model=List[HotspotItem])
def get_hotspots(limit: int = Query(10, ge=1, le=100)):
    """Returns modules ranked by semantic churn count (logic_change and api_change count)."""
    repository = get_repo()
    return repository.get_hotspots(limit=limit)
