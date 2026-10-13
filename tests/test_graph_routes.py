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


def test_detailed_impact_endpoint(api_client, temp_git_repo):
    # 1. Trigger analysis job
    response = api_client.post(
        "/repos/analyze",
        json={"repo_url_or_path": temp_git_repo, "commit_depth": 10},
    )
    assert response.status_code == 202
    job_id = response.json()["job_id"]

    # 2. Poll job status until complete
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

    assert completed, "Analysis job did not complete in time"

    # 3. Retrieve commits to select target SHA
    commits_res = api_client.get("/commits", params={"job_id": job_id})
    assert commits_res.status_code == 200
    commits_list = commits_res.json()
    assert len(commits_list) > 0
    target_sha = commits_list[0]["sha"]

    # 4. Assert: 200 and every edge endpoint is in nodes
    detailed_res = api_client.get(f"/commits/{target_sha}/impact/detailed", params={"hops": 3})
    assert detailed_res.status_code == 200
    data = detailed_res.json()

    assert data["commit_sha"] == target_sha
    assert "nodes" in data
    assert "edges" in data
    assert "stats" in data
    assert "warnings" in data

    node_ids = {node["id"] for node in data["nodes"]}
    for edge in data["edges"]:
        assert edge["source"] in node_ids
        assert edge["target"] in node_ids

    # 5. Assert: hops=1 returns only hop<=1
    detailed_hops1_res = api_client.get(f"/commits/{target_sha}/impact/detailed", params={"hops": 1})
    assert detailed_hops1_res.status_code == 200
    data_hops1 = detailed_hops1_res.json()
    assert data_hops1["hop_limit"] == 1
    for node in data_hops1["nodes"]:
        assert node["hop"] <= 1

    node_ids_hops1 = {node["id"] for node in data_hops1["nodes"]}
    for edge in data_hops1["edges"]:
        assert edge["source"] in node_ids_hops1
        assert edge["target"] in node_ids_hops1

    # 6. Assert: unknown sha -> 404
    unknown_res = api_client.get("/commits/0000000000000000000000000000000000000000/impact/detailed")
    assert unknown_res.status_code == 404
    assert unknown_res.json()["detail"] == "Impact subgraph not found for commit SHA"
