"""Tests for Module 3: Dependency Graph."""

import pytest
import networkx as nx
from semantix.models import ChangeRecord
from semantix.dependency_graph import DependencyGraphBuilder, ImpactAnalyzer
from semantix.ingestion.git_ingest import GitIngestor


def test_dependency_graph_builder_python_and_js():
    builder = DependencyGraphBuilder()
    files = {
        "math_utils.py": "def add(a, b):\n    return a + b\n\ndef sum_list(items):\n    res = 0\n    for i in items:\n        res = add(res, i)\n    return res\n",
        "app.py": "import math_utils\n\ndef run():\n    math_utils.sum_list([1, 2, 3])\n",
        "helper.js": "function helperA() { return 1; }\nfunction helperB() { return helperA() + 2; }\n",
    }

    graph = builder.build_graph_for_files(files)

    assert graph.has_node("math_utils.py")
    assert graph.has_node("math_utils.py:add")
    assert graph.has_node("math_utils.py:sum_list")
    assert graph.has_edge("math_utils.py", "math_utils.py:add")
    assert graph.has_edge("app.py", "math_utils.py")

    assert graph.has_node("helper.js:helperA")
    assert graph.has_node("helper.js:helperB")


def test_impact_analyzer_hops():
    builder = DependencyGraphBuilder()
    files = {
        "base.py": "def lower(): return 42\n",
        "mid.py": "from base import lower\ndef middle(): return lower()\n",
        "top.py": "from mid import middle\ndef upper(): return middle()\n",
    }
    graph = builder.build_graph_for_files(files)

    analyzer = ImpactAnalyzer()
    cr = ChangeRecord(
        commit_sha="abc1234",
        file="base.py",
        change_type="logic_change",
        confidence=0.85,
        ast_edit_summary="Modified lower()",
    )

    impact = analyzer.compute_impact(graph, cr, hop_limit=3)

    assert impact.changed_node in ("base.py", "base.py:lower")
    assert len(impact.direct_impacts) > 0
    # mid.py and top.py should be in direct or transitive impacts
    all_impacts = set(impact.direct_impacts) | set(impact.transitive_impacts)
    assert any("mid.py" in node for node in all_impacts)


def test_dependency_graph_with_git_repo(temp_git_repo):
    ingestor = GitIngestor(temp_git_repo)
    commits = ingestor.get_commits(depth=100)

    # Collect latest version of files
    file_contents = {}
    for commit in reversed(commits):  # Chronological order
        for cf in commit.changed_files:
            if cf.new_content is not None:
                file_contents[cf.file_path] = cf.new_content

    builder = DependencyGraphBuilder()
    graph = builder.build_graph_for_files(file_contents)

    assert graph.number_of_nodes() > 0

    analyzer = ImpactAnalyzer()
    cr = ChangeRecord(
        commit_sha=commits[0].sha,
        file="main.py",
        change_type="logic_change",
        confidence=0.90,
        ast_edit_summary="Refactored calculate_total",
    )
    impact = analyzer.compute_impact(graph, cr, hop_limit=3)

    assert impact.changed_node is not None
    ingestor.close()
