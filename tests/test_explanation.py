"""Tests for Module 4: Explanation Layer."""

import pytest
from semantix.models import ChangeRecord, ImpactSubgraph, Explanation
from semantix.explanation import LLMExplainer


def test_prompt_building():
    explainer = LLMExplainer()
    cr = ChangeRecord(
        commit_sha="c123456",
        file="auth.py",
        change_type="api_change",
        confidence=0.90,
        ast_edit_summary="Added param token to login()",
        embedding_similarity=0.75,
    )
    subgraph = ImpactSubgraph(
        changed_node="auth.py:login",
        direct_impacts=["server.py:handle_auth", "user.py:login_user"],
        transitive_impacts=["router.py:route_request"],
    )

    prompt = explainer._build_prompt(cr, subgraph, "def login(user, token): pass", affected_count=3)

    assert "Target File: auth.py" in prompt
    assert "api_change" in prompt
    assert "auth.py:login" in prompt
    assert "server.py:handle_auth" in prompt
    assert "def login(user, token): pass" in prompt


def test_json_parsing_and_markdown_cleaning():
    explainer = LLMExplainer()
    raw_markdown_json = """```json
{
  "summary": "Updated login signature",
  "why_it_matters": "Requires updating token in callers",
  "affected_count": 3,
  "risk_level": "high"
}
```"""
    parsed = explainer._parse_json(raw_markdown_json)

    assert parsed is not None
    assert parsed["summary"] == "Updated login signature"
    assert parsed["risk_level"] == "high"
    assert parsed["affected_count"] == 3


def test_heuristic_fallback_when_credentials_absent():
    explainer = LLMExplainer()  # No env vars set in test by default
    cr = ChangeRecord(
        commit_sha="c123456",
        file="core.py",
        change_type="logic_change",
        confidence=0.85,
        ast_edit_summary="Modified compute() loop",
        embedding_similarity=0.80,
    )
    subgraph = ImpactSubgraph(
        changed_node="core.py",
        direct_impacts=["app.py"],
        transitive_impacts=[],
    )

    explanation = explainer.generate_explanation("c123456", cr, subgraph, "def compute(): return 42")

    assert isinstance(explanation, Explanation)
    assert explanation.commit_sha == "c123456"
    assert explanation.summary != ""
    assert explanation.why_it_matters != ""
    assert explanation.affected_count == 1
    assert explanation.risk_level in ("low", "medium", "high", "critical")
