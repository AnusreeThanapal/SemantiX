"""Tests for Module 6: FastAPI Endpoints and Background Job Execution."""

import os
import tempfile
import time
import pytest
from fastapi.testclient import TestClient
from semantix.api.app import app


@pytest.fixture
def api_client(monkeypatch):
    temp_dir = tempfile.mkdtemp(prefix="semantix_api_test_")
    db_path = os.path.join(temp_dir, "test_api_semantix.db")
    monkeypatch.setenv("SEMANTIX_DB_PATH", db_path)
    return TestClient(app)



def test_api_root(api_client):
    res = api_client.get("/")
    assert res.status_code == 200
    data = res.json()
    assert "SemantiX" in data["message"]


def test_full_pipeline_via_api(api_client, temp_git_repo):
    # 1. Trigger analysis job
    response = api_client.post(
        "/repos/analyze",
        json={"repo_url_or_path": temp_git_repo, "commit_depth": 10},
    )
    assert response.status_code == 202
    data = response.json()
    assert "job_id" in data
    job_id = data["job_id"]
    assert data["status"] == "pending"

    # 2. Poll job status until complete (or up to 10 seconds)
    completed = False
    for _ in range(20):
        job_res = api_client.get(f"/jobs/{job_id}")
        assert job_res.status_code == 200
        job_data = job_res.json()
        if job_data["status"] == "complete":
            completed = True
            break
        elif job_data["status"] == "failed":
            pytest.fail(f"Job failed with error: {job_data.get('error')}")
        time.sleep(0.5)

    assert completed, "Background analysis job did not complete in time"

    # 3. Test GET /commits
    commits_res = api_client.get("/commits")
    assert commits_res.status_code == 200
    commits_list = commits_res.json()
    assert len(commits_list) == 3

    target_sha = commits_list[0]["sha"]
    assert "change_type" in commits_list[0]
    assert "risk_level" in commits_list[0]

    # 4. Test GET /commits/{sha}/impact
    impact_res = api_client.get(f"/commits/{target_sha}/impact")
    assert impact_res.status_code == 200
    impact_data = impact_res.json()
    if isinstance(impact_data, list):
        assert len(impact_data) > 0
        assert "changed_node" in impact_data[0]
    else:
        assert "changed_node" in impact_data

    # 5. Test GET /commits/{sha}/explanation
    exp_res = api_client.get(f"/commits/{target_sha}/explanation")
    assert exp_res.status_code == 200
    exp_data = exp_res.json()
    if isinstance(exp_data, list):
        assert len(exp_data) > 0
        assert exp_data[0]["commit_sha"] == target_sha
        assert exp_data[0]["summary"] != ""
        assert exp_data[0]["risk_level"] in ("low", "medium", "high", "critical")
    else:
        assert exp_data["commit_sha"] == target_sha
        assert exp_data["summary"] != ""
        assert exp_data["risk_level"] in ("low", "medium", "high", "critical")

    # 6. Test GET /hotspots
    hotspots_res = api_client.get("/hotspots")
    assert hotspots_res.status_code == 200
    hotspots_data = hotspots_res.json()
    assert isinstance(hotspots_data, list)


def test_multi_file_commit_pipeline_via_api(api_client):
    """Test full pipeline analysis for a commit touching 3+ files."""
    import git
    temp_dir = tempfile.mkdtemp(prefix="semantix_multi_repo_")
    repo = git.Repo.init(temp_dir)
    with repo.config_writer() as config:
        config.set_value("user", "name", "Multi Dev")
        config.set_value("user", "email", "multidev@example.com")

    # Initial commit
    file_a = os.path.join(temp_dir, "service_a.py")
    file_b = os.path.join(temp_dir, "service_b.py")
    file_c = os.path.join(temp_dir, "service_c.py")

    with open(file_a, "w", encoding="utf-8") as f:
        f.write("def func_a(): pass\n")
    with open(file_b, "w", encoding="utf-8") as f:
        f.write("def func_b(): pass\n")
    with open(file_c, "w", encoding="utf-8") as f:
        f.write("def func_c(): pass\n")

    repo.index.add(["service_a.py", "service_b.py", "service_c.py"])
    repo.index.commit("Initial multi-file commit")

    # Second commit: modify all 3 files
    with open(file_a, "w", encoding="utf-8") as f:
        f.write("def func_a(x=1):\n    return x * 2\n")
    with open(file_b, "w", encoding="utf-8") as f:
        f.write("def func_b(y=2):\n    return y + 10\n")
    with open(file_c, "w", encoding="utf-8") as f:
        f.write("def func_c(z=3):\n    return z ** 2\n")

    repo.index.add(["service_a.py", "service_b.py", "service_c.py"])
    commit2 = repo.index.commit("Modify services A, B, and C")
    target_sha = commit2.hexsha

    # Trigger analysis
    response = api_client.post(
        "/repos/analyze",
        json={"repo_url_or_path": temp_dir, "commit_depth": 5},
    )
    assert response.status_code == 202
    job_id = response.json()["job_id"]

    # Poll for completion
    completed = False
    for _ in range(20):
        job_res = api_client.get(f"/jobs/{job_id}")
        assert job_res.status_code == 200
        job_data = job_res.json()
        if job_data["status"] == "complete":
            completed = True
            break
        elif job_data["status"] == "failed":
            pytest.fail(f"Job failed: {job_data.get('error')}")
        time.sleep(0.5)

    assert completed

    # Query multi-file impact without file_path -> should return list
    impact_res = api_client.get(f"/commits/{target_sha}/impact")
    assert impact_res.status_code == 200
    impact_data = impact_res.json()
    assert isinstance(impact_data, list)
    assert len(impact_data) == 3
    file_paths = {item.get("file_path") for item in impact_data}
    assert file_paths == {"service_a.py", "service_b.py", "service_c.py"}

    # Query impact with specific file_path -> should return single object
    impact_a = api_client.get(f"/commits/{target_sha}/impact?file_path=service_a.py")
    assert impact_a.status_code == 200
    impact_a_data = impact_a.json()
    assert isinstance(impact_a_data, dict)
    assert impact_a_data["file_path"] == "service_a.py"

    # Query multi-file explanation without file_path -> should return list
    exp_res = api_client.get(f"/commits/{target_sha}/explanation")
    assert exp_res.status_code == 200
    exp_data = exp_res.json()
    assert isinstance(exp_data, list)
    assert len(exp_data) == 3

    # Query explanation with specific file_path -> should return single object
    exp_b = api_client.get(f"/commits/{target_sha}/explanation?file_path=service_b.py")
    assert exp_b.status_code == 200
    exp_b_data = exp_b.json()
    assert isinstance(exp_b_data, dict)
    assert exp_b_data["file_path"] == "service_b.py"
    assert exp_b_data["commit_sha"] == target_sha

