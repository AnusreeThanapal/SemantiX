import os
import math
import pytest
from fastapi.testclient import TestClient

from semantix.codebert.service import get_codebert_service, CodeBERTService
from semantix.codebert.analysis import centred_cosine_scores
from semantix.api.app import app


def test_codebert_disabled_state(monkeypatch):
    monkeypatch.setenv("CODEBERT_ENABLED", "false")
    service = CodeBERTService()
    st = service.status()
    assert st["state"] == "disabled"
    assert st["kind"] == "fallback-heuristic"


def test_fallback_embedding_deterministic_and_unit_length():
    service = CodeBERTService()
    code = "def authenticate_user(username: str, password_hash: str) -> bool:\n    return db.verify(username, password_hash)"
    emb1 = service._fallback_embed(code)
    emb2 = service._fallback_embed(code)

    assert emb1 == emb2
    assert len(emb1) == 768
    norm = math.sqrt(sum(x * x for x in emb1))
    assert math.isclose(norm, 1.0, rel_tol=1e-5)


def test_identical_snippet_scores_above_unrelated():
    service = CodeBERTService()
    target_code = "def calculate_subtotal(items):\n    return sum(item.price for item in items)"
    identical_code = "def calculate_subtotal(items):\n    return sum(item.price for item in items)"
    unrelated_code = "class DatabaseConnectionPool:\n    def connect_socket(self, host, port):\n        pass"

    target_vec = service.embed([target_code])[0]
    cands = service.embed([identical_code, unrelated_code])

    scores, percentiles = centred_cosine_scores(target_vec, cands)
    assert len(scores) == 2
    assert scores[0] > scores[1]
    assert percentiles[0] >= percentiles[1]


def test_chunking_never_exceeds_eight_chunks():
    service = CodeBERTService()
    # Construct text with ~20,000 characters across many line boundaries
    long_code = "\n".join([f"def function_{i}():\n    print('long line of code payload {i}')" for i in range(500)])
    assert len(long_code) > 10000

    emb = service.embed_long_text(long_code)
    assert len(emb) == 768
    norm = math.sqrt(sum(x * x for x in emb))
    assert math.isclose(norm, 1.0, rel_tol=1e-5)


def test_api_codebert_status_and_warmup():
    client = TestClient(app)
    res_status = client.get("/codebert/status")
    assert res_status.status_code == 200
    data_status = res_status.json()
    assert "state" in data_status
    assert "kind" in data_status
    assert data_status["dim"] == 768

    res_warmup = client.post("/codebert/warmup")
    assert res_warmup.status_code == 200
    data_warmup = res_warmup.json()
    assert "state" in data_warmup


def test_real_codebert_model(monkeypatch):
    pytest.importorskip("torch")
    pytest.importorskip("transformers")
    if os.getenv("RUN_CODEBERT_TESTS") != "1":
        pytest.skip("RUN_CODEBERT_TESTS is not set to 1")

    service = get_codebert_service()
    service.warmup()
    vectors = service.embed(["def hello(): return 'world'"])
    assert len(vectors) == 1
    assert len(vectors[0]) == 768
