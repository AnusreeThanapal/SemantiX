"""Tree-sitter parser initialization and AST helpers for Python and JavaScript."""

import logging
from typing import Optional, Tuple
import tree_sitter
from tree_sitter import Language, Parser
import tree_sitter_python as tspython
import tree_sitter_javascript as tsjavascript

logger = logging.getLogger("semantix.semantic_diff.parser")

# Pre-initialize languages and parsers
PY_LANGUAGE = Language(tspython.language())
JS_LANGUAGE = Language(tsjavascript.language())

PY_PARSER = Parser(PY_LANGUAGE)
JS_PARSER = Parser(JS_LANGUAGE)


def get_parser_for_file(file_path: str) -> Tuple[Optional[Parser], Optional[str]]:
    """Returns (parser, language_name) based on file extension."""
    ext = file_path.lower().split(".")[-1] if "." in file_path else ""
    if ext in ("py", "pyw"):
        return PY_PARSER, "python"
    elif ext in ("js", "jsx", "mjs", "cjs"):
        return JS_PARSER, "javascript"
    return None, None


def parse_code(code: Optional[str], file_path: str) -> Optional[tree_sitter.Tree]:
    """Parse source code string into a tree-sitter Tree."""
    if code is None:
        return None
    parser, lang = get_parser_for_file(file_path)
    if not parser:
        logger.debug(f"Unsupported file type for tree-sitter: {file_path}")
        return None

    try:
        bytes_code = code.encode("utf-8")
        return parser.parse(bytes_code)
    except Exception as e:
        logger.warning(f"Error parsing {file_path} with tree-sitter ({lang}): {e}")
        return None
