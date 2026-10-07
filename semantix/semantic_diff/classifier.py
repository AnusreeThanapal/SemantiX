"""Heuristic classifier for semantic change classification."""

import re
import logging
from typing import Dict, Any, Optional, Tuple

logger = logging.getLogger("semantix.semantic_diff.classifier")


class HeuristicClassifier:
    """Classifies file-level changes using AST edit metrics and diff text heuristics."""

    def classify(
        self,
        git_change_type: str,
        old_code: Optional[str],
        new_code: Optional[str],
        ast_diff_res: Dict[str, Any],
        file_path: str,
    ) -> Tuple[str, float]:
        """Returns (change_type, confidence)."""
        counts = ast_diff_res.get("counts", {})
        inserted = counts.get("inserted", 0)
        deleted = counts.get("deleted", 0)
        updated = counts.get("updated", 0)
        unchanged = counts.get("unchanged", 0)

        # 1. Rename check
        if git_change_type == "renamed":
            return "rename", 0.95

        # 2. Deleted or Newly Added file check
        if old_code is None or new_code is None:
            return "logic_change", 0.85

        # Stripped code comparison for formatting/cosmetic check
        old_stripped = "".join(old_code.split())
        new_stripped = "".join(new_code.split())
        if old_stripped == new_stripped:
            return "formatting/cosmetic", 0.95

        # No AST node structural changes (only whitespace / comment edits)
        if inserted == 0 and deleted == 0 and updated == 0 and unchanged > 0:
            return "formatting/cosmetic", 0.90

        # Extract textual diff lines for regex pattern checking
        old_lines = set(old_code.splitlines())
        new_lines = set(new_code.splitlines())
        added_lines = "\n".join(new_lines - old_lines)
        removed_lines = "\n".join(old_lines - new_lines)

        # 3. Bug Fix Pattern check (null/None checks, try/catch, boundary fixes)
        bug_fix_patterns = [
            r"if\s+.*is\s+not\s+None",
            r"if\s+not\s+",
            r"if\s*\(!?\w+\)",
            r"try\s*:",
            r"catch\s*\(",
            r"except\s+",
            r"raise\s+",
            r"throw\s+",
            r"return\s+None",
            r"return\s+null",
        ]
        for pattern in bug_fix_patterns:
            if re.search(pattern, added_lines, re.IGNORECASE):
                return "bug_fix_pattern", 0.85

        # 4. API Change check (function/class signature, parameters, exports)
        api_patterns = [
            r"def\s+\w+\s*\(",
            r"class\s+\w+",
            r"function\s+\w+\s*\(",
            r"export\s+",
            r"async\s+def\s+\w+\s*\(",
        ]
        for pattern in api_patterns:
            if re.search(pattern, added_lines, re.IGNORECASE) and re.search(pattern, removed_lines, re.IGNORECASE):
                # Signature was modified
                return "api_change", 0.90
            elif re.search(pattern, added_lines, re.IGNORECASE) and not re.search(pattern, removed_lines, re.IGNORECASE):
                # New public API export/function added
                return "api_change", 0.85


        # 5. Refactor check (moving blocks, renaming variables without heavy AST disruption)
        if updated > 0 and inserted == 0 and deleted == 0:
            return "refactor", 0.80

        # 6. Logic change check (default for functional code edits)
        if inserted > 0 or deleted > 0 or updated > 0:
            return "logic_change", 0.80

        return "unknown", 0.50
