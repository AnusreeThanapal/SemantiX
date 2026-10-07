"""Semantic diffing module for SemantiX."""

from .parser import parse_code, get_parser_for_file
from .ast_diff import ASTDiffEngine
from .classifier import HeuristicClassifier
from .embedding_diff import EmbeddingDiffAnalyzer
from .diff_pipeline import SemanticDiffPipeline

__all__ = [
    "parse_code",
    "get_parser_for_file",
    "ASTDiffEngine",
    "HeuristicClassifier",
    "EmbeddingDiffAnalyzer",
    "SemanticDiffPipeline",
]

