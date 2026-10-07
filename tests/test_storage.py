"""Tests for Module 5: Storage Layer."""

import os
import tempfile
import pytest
from semantix.models import Commit, ChangedFile, ChangeRecord, ImpactSubgraph, Explanation, AnalysisJob
from semantix.storage import SQLiteRepository


@pytest.fixture
def temp_db():
    temp_dir = tempfile.mkdtemp(prefix="semantix_db_test_")
    db_path = os.path.join(temp_dir, "test_semantix.db")
    repo = SQLiteRepository(db_path=db_path)
    yield repo


def test_repository_commit_and_records(temp_db):
    repo = temp_db
    commit = Commit(
        sha="abc123456789",
        author="Dev <dev@test.com>",
        timestamp="2026-08-23T12:00:00",
        message="Add user auth",
        changed_files=[
            ChangedFile(file_path="auth.py", change_type="added", old_content=None, new_content="def login(): pass")
        ],
    )
    repo.save_commit(commit)

    cr = ChangeRecord(
        commit_sha="abc123456789",
        file="auth.py",
        change_type="api_change",
        confidence=0.90,
        ast_edit_summary="Added login()",
        embedding_similarity=0.85,
    )
    repo.save_change_records([cr])

    records = repo.get_change_records_for_commit("abc123456789")
    assert len(records) == 1
    assert records[0].file == "auth.py"
    assert records[0].change_type == "api_change"

    commits_page = repo.get_commits_paginated(limit=10, offset=0)
    assert len(commits_page) == 1
    assert commits_page[0]["sha"] == "abc123456789"
    assert commits_page[0]["change_type"] == "api_change"


def test_repository_impact_and_explanation(temp_db):
    repo = temp_db
    sha = "c999"
    subgraph = ImpactSubgraph(
        changed_node="main.py",
        direct_impacts=["service.py"],
        transitive_impacts=["app.py"],
    )
    repo.save_impact_subgraph(sha, subgraph)

    exp = Explanation(
        commit_sha=sha,
        summary="Refactored main entrypoint",
        why_it_matters="Changes application initialization order",
        affected_count=2,
        risk_level="high",
    )
    repo.save_explanation(exp)

    fetched_subgraph = repo.get_impact_subgraph_for_commit(sha)
    assert fetched_subgraph is not None
    assert fetched_subgraph.changed_node == "main.py"
    assert "service.py" in fetched_subgraph.direct_impacts

    fetched_exp = repo.get_explanation_for_commit(sha)
    assert fetched_exp is not None
    assert fetched_exp.risk_level == "high"
    assert fetched_exp.affected_count == 2


def test_hotspots_calculation(temp_db):
    repo = temp_db
    records = [
        ChangeRecord(commit_sha="s1", file="core.py", change_type="logic_change", confidence=0.9, ast_edit_summary="a"),
        ChangeRecord(commit_sha="s2", file="core.py", change_type="api_change", confidence=0.9, ast_edit_summary="b"),
        ChangeRecord(commit_sha="s3", file="util.py", change_type="formatting/cosmetic", confidence=0.9, ast_edit_summary="c"),
        ChangeRecord(commit_sha="s4", file="core.py", change_type="logic_change", confidence=0.9, ast_edit_summary="d"),
    ]
    repo.save_change_records(records)

    hotspots = repo.get_hotspots(limit=10)
    assert len(hotspots) == 1
    assert hotspots[0].module == "core.py"
    assert hotspots[0].semantic_churn_count == 3


def test_job_persistence(temp_db):
    repo = temp_db
    job = AnalysisJob(job_id="job_001", status="pending", created_at="2026-08-23T12:00:00")
    repo.save_job(job)

    fetched = repo.get_job("job_001")
    assert fetched is not None
    assert fetched.status == "pending"

    job.status = "complete"
    repo.save_job(job)
    updated = repo.get_job("job_001")
    assert updated.status == "complete"


def test_repository_multi_file_commit_impact_and_explanations(temp_db):
    repo = temp_db
    sha = "multi_file_sha_123"
    files = ["auth.py", "database.py", "routes.py", "utils.py"]

    for f in files:
        subgraph = ImpactSubgraph(
            commit_sha=sha,
            file_path=f,
            changed_node=f,
            direct_impacts=[f"{f}_dep1", f"{f}_dep2"],
            transitive_impacts=[f"{f}_trans"],
        )
        repo.save_impact_subgraph(sha, subgraph, file_path=f)

        exp = Explanation(
            commit_sha=sha,
            file_path=f,
            summary=f"Changed {f}",
            why_it_matters=f"Affects {f} architecture",
            affected_count=3,
            risk_level="medium",
        )
        repo.save_explanation(exp, file_path=f)

    # 1. Fetch all subgraphs for commit
    all_subgraphs = repo.get_impact_subgraphs_for_commit(sha)
    assert len(all_subgraphs) == 4
    file_paths_found = {sg.file_path for sg in all_subgraphs}
    assert file_paths_found == set(files)

    # 2. Fetch specific subgraph by file
    sg_auth = repo.get_impact_subgraph_for_commit(sha, file_path="auth.py")
    assert sg_auth is not None
    assert sg_auth.changed_node == "auth.py"
    assert "auth.py_dep1" in sg_auth.direct_impacts

    # 3. Fetch all explanations for commit
    all_exps = repo.get_explanations_for_commit(sha)
    assert len(all_exps) == 4

    # 4. Fetch specific explanation by file
    exp_db = repo.get_explanation_for_commit(sha, file_path="database.py")
    assert exp_db is not None
    assert exp_db.summary == "Changed database.py"
    assert exp_db.file_path == "database.py"

