"""Tests for Module 1: Ingestion."""

import pytest
from semantix.ingestion.git_ingest import GitIngestor
from semantix.models import Commit


def test_git_ingestor_commit_history(temp_git_repo):
    ingestor = GitIngestor(temp_git_repo)
    commits = ingestor.get_commits(depth=100)

    # Should walk all 3 commits
    assert len(commits) == 3

    # Check commit order (Git iter_commits returns newest commit first)
    c3, c2, c1 = commits[0], commits[1], commits[2]

    assert "Commit 3" in c3.message
    assert "Commit 2" in c2.message
    assert "Initial commit" in c1.message

    # Verify commit 3 changed_files
    c3_file_paths = [cf.file_path for cf in c3.changed_files]
    assert "main.py" in c3_file_paths

    main_cf = next(cf for cf in c3.changed_files if cf.file_path == "main.py")
    assert main_cf.change_type == "modified"
    assert main_cf.old_content is not None
    assert main_cf.new_content is not None
    assert "tax_rate" in main_cf.new_content
    assert "tax_rate" not in main_cf.old_content

    # Verify initial commit
    c1_file_paths = [cf.file_path for cf in c1.changed_files]
    assert "main.py" in c1_file_paths
    assert "utils.js" in c1_file_paths

    ingestor.close()
