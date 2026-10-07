"""Tests for Module 2: Semantic Diff."""

import pytest
from semantix.ingestion.git_ingest import GitIngestor
from semantix.semantic_diff import (
    parse_code,
    ASTDiffEngine,
    HeuristicClassifier,
    EmbeddingDiffAnalyzer,
    SemanticDiffPipeline,
)


def test_tree_sitter_parser():
    py_tree = parse_code("def foo(x):\n    return x + 1", "test.py")
    assert py_tree is not None
    assert py_tree.root_node.type == "module"

    js_tree = parse_code("function bar(y) { return y * 2; }", "test.js")
    assert js_tree is not None
    assert js_tree.root_node.type == "program"


def test_ast_diff_engine():
    engine = ASTDiffEngine()
    old_code = "def add(a, b):\n    return a + b"
    new_code = "def add(a, b, c=0):\n    return a + b + c"

    old_tree = parse_code(old_code, "math.py")
    new_tree = parse_code(new_code, "math.py")

    res = engine.diff(old_tree, new_tree, old_code, new_code)
    assert res["counts"]["inserted"] > 0 or res["counts"]["updated"] > 0
    assert "AST diff" in res["summary"]


def test_heuristic_classifier():
    classifier = HeuristicClassifier()
    ast_res = {"counts": {"inserted": 1, "deleted": 0, "updated": 1, "unchanged": 5}}

    # Test bug fix pattern
    change_type, conf = classifier.classify(
        git_change_type="modified",
        old_code="val = data['x']",
        new_code="if data is not None:\n    val = data['x']",
        ast_diff_res=ast_res,
        file_path="service.py",
    )
    assert change_type == "bug_fix_pattern"
    assert conf >= 0.80

    # Test cosmetic formatting
    change_type_fmt, _ = classifier.classify(
        git_change_type="modified",
        old_code="def x(): pass",
        new_code="def x():\n    pass",
        ast_diff_res={"counts": {"inserted": 0, "deleted": 0, "updated": 0, "unchanged": 4}},
        file_path="service.py",
    )
    assert change_type_fmt == "formatting/cosmetic"


def test_embedding_diff_analyzer_and_caching():
    analyzer = EmbeddingDiffAnalyzer()
    code1 = "def process(items):\n    return [i * 2 for i in items]"
    code2 = "def process(items):\n    return [i * 3 for i in items]"

    sim1 = analyzer.compute_similarity("proc.py", code1, code2)
    assert sim1 is not None
    assert 0.0 <= sim1 <= 1.0

    # Check cache hit
    hash1 = list(analyzer._cache.keys())[0]
    cached_vec = analyzer.get_embedding("proc.py", code1)
    assert cached_vec is not None


def test_semantic_diff_pipeline_with_git_repo(temp_git_repo):
    ingestor = GitIngestor(temp_git_repo)
    commits = ingestor.get_commits(depth=100)
    pipeline = SemanticDiffPipeline()

    all_records = []
    for commit in commits:
        records = pipeline.process_commit(commit)
        all_records.extend(records)

    assert len(all_records) >= 3
    for record in all_records:
        assert record.commit_sha is not None
        assert record.file in ("main.py", "utils.js")
        assert record.change_type in (
            "rename",
            "formatting/cosmetic",
            "refactor",
            "logic_change",
            "api_change",
            "bug_fix_pattern",
            "unknown",
        )
        assert record.confidence > 0.0
        assert record.ast_edit_summary != ""

    ingestor.close()
