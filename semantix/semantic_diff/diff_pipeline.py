"""Semantic diff pipeline tying together tree-sitter, AST diffing, heuristic classification, and embedding similarity."""

import logging
from typing import List, Optional, Dict
from semantix.models import Commit, ChangedFile, ChangeRecord
from semantix.semantic_diff.parser import parse_code
from semantix.semantic_diff.ast_diff import ASTDiffEngine
from semantix.semantic_diff.classifier import HeuristicClassifier
from semantix.semantic_diff.embedding_diff import EmbeddingDiffAnalyzer

logger = logging.getLogger("semantix.semantic_diff")


class SemanticDiffPipeline:
    """Orchestrates structural AST diffing, heuristic classification, and embedding similarity."""

    def __init__(self, embedding_analyzer: Optional[EmbeddingDiffAnalyzer] = None):
        self.ast_engine = ASTDiffEngine()
        self.classifier = HeuristicClassifier()
        self.embedding_analyzer = embedding_analyzer or EmbeddingDiffAnalyzer()

    def process_commit(self, commit: Commit) -> List[ChangeRecord]:
        """Generate ChangeRecords for all modified files in a commit."""
        records: List[ChangeRecord] = []
        for cf in commit.changed_files:
            logger.info("Processing semantic diff", extra={"commit_sha": commit.sha, "file": cf.file_path, "stage": "semantic_diff"})
            record = self.process_file_change(commit.sha, cf)
            records.append(record)
        return records

    def process_file_change(self, commit_sha: str, changed_file: ChangedFile) -> ChangeRecord:
        old_code = changed_file.old_content
        new_code = changed_file.new_content
        file_path = changed_file.file_path

        # 1. Parse tree-sitter ASTs
        old_tree = parse_code(old_code, file_path) if old_code else None
        new_tree = parse_code(new_code, file_path) if new_code else None

        # 2. Compute structural AST diff
        ast_diff_res = self.ast_engine.diff(old_tree, new_tree, old_code or "", new_code or "")
        ast_edit_summary = ast_diff_res["summary"]

        # 3. Classify using heuristics
        change_type, confidence = self.classifier.classify(
            git_change_type=changed_file.change_type,
            old_code=old_code,
            new_code=new_code,
            ast_diff_res=ast_diff_res,
            file_path=file_path,
        )

        # 4. Secondary signal: Embedding similarity
        embedding_sim = self.embedding_analyzer.compute_similarity(file_path, old_code, new_code)

        return ChangeRecord(
            commit_sha=commit_sha,
            file=file_path,
            change_type=change_type,
            confidence=confidence,
            ast_edit_summary=ast_edit_summary,
            embedding_similarity=embedding_sim,
        )
