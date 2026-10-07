"""LLM explanation layer using Azure OpenAI GPT-4o with structured JSON schema enforcement."""

import os
import json
import logging
from typing import Optional, Dict, Any
from openai import AzureOpenAI

from semantix.models import ChangeRecord, ImpactSubgraph, Explanation

logger = logging.getLogger("semantix.explanation.llm_explainer")


class LLMExplainer:
    """Generates structured semantic explanations for code changes using Azure OpenAI GPT-4o."""

    def __init__(self):
        self.endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        self.api_key = os.getenv("AZURE_OPENAI_KEY")
        self.deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o")
        self.api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-01")

        self.client: Optional[AzureOpenAI] = None
        if self.endpoint and self.api_key:
            try:
                self.client = AzureOpenAI(
                    azure_endpoint=self.endpoint,
                    api_key=self.api_key,
                    api_version=self.api_version,
                )
            except Exception as e:
                logger.warning(f"Failed to initialize AzureOpenAI client for explanations: {e}")

    def generate_explanation(
        self,
        commit_sha: str,
        change_record: ChangeRecord,
        impact_subgraph: ImpactSubgraph,
        code_snippet_window: Optional[str] = None,
    ) -> Explanation:
        """Generate structured explanation using GPT-4o or heuristic fallback."""
        affected_count = len(impact_subgraph.direct_impacts) + len(impact_subgraph.transitive_impacts)

        if not self.client:
            logger.info("Azure OpenAI credentials not set. Using heuristic fallback explainer.", extra={"commit_sha": commit_sha})
            return self._heuristic_fallback(commit_sha, change_record, impact_subgraph, affected_count)

        prompt = self._build_prompt(change_record, impact_subgraph, code_snippet_window, affected_count)

        # First Attempt
        raw_response = self._call_llm(prompt)
        parsed = self._parse_json(raw_response)

        if not parsed:
            # Retry once with stricter prompt instruction
            logger.warning("JSON parse failed on first attempt. Retrying with strict JSON instruction...", extra={"commit_sha": commit_sha})
            retry_prompt = prompt + "\n\nCRITICAL: Your previous response was invalid. Respond ONLY with raw JSON matching the required schema. Do NOT include markdown code blocks, backticks, or preamble."
            raw_response = self._call_llm(retry_prompt)
            parsed = self._parse_json(raw_response)

        if parsed:
            return Explanation(
                commit_sha=commit_sha,
                summary=parsed.get("summary", f"Modified {change_record.file} ({change_record.change_type})"),
                why_it_matters=parsed.get("why_it_matters", f"Impacts {affected_count} downstream dependencies."),
                affected_count=int(parsed.get("affected_count", affected_count)),
                risk_level=parsed.get("risk_level", "medium").lower(),
            )
        else:
            logger.warning("Retry also failed to produce valid JSON. Using text fallback.", extra={"commit_sha": commit_sha})
            summary_text = raw_response[:300] if raw_response else f"Modification in {change_record.file}"
            return Explanation(
                commit_sha=commit_sha,
                summary=summary_text,
                why_it_matters=f"Change affects {affected_count} nodes in the dependency graph.",
                affected_count=affected_count,
                risk_level=self._determine_risk_level(change_record.change_type, affected_count),
            )

    def _build_prompt(
        self,
        change_record: ChangeRecord,
        impact_subgraph: ImpactSubgraph,
        code_snippet_window: Optional[str],
        affected_count: int,
    ) -> str:
        snippet_text = code_snippet_window or "Snippet not available."
        direct_nodes = ", ".join(impact_subgraph.direct_impacts[:5]) or "None"
        transitive_nodes = ", ".join(impact_subgraph.transitive_impacts[:5]) or "None"

        return f"""You are SemantiX AI, an expert code evolution analyst. Analyze this commit change and dependency impact.

CHANGE CONTEXT:
- Target File: {change_record.file}
- Change Type: {change_record.change_type} (Confidence: {change_record.confidence:.2f})
- AST Edit Summary: {change_record.ast_edit_summary}
- Embedding Similarity Score: {change_record.embedding_similarity}

DEPENDENCY GRAPH IMPACT:
- Changed Node: {impact_subgraph.changed_node}
- Directly Affected Nodes: {direct_nodes}
- Transitively Affected Nodes: {transitive_nodes}
- Total Affected Count: {affected_count}

CODE SNIPPET WINDOW:
```
{snippet_text}
```

INSTRUCTIONS:
Generate a concise, high-value visual analytics explanation.
Respond ONLY with a JSON object strictly adhering to this schema:
{{
  "summary": "<1-2 sentence overview of what changed>",
  "why_it_matters": "<1-2 sentence technical breakdown of impact and why developers should care>",
  "affected_count": {affected_count},
  "risk_level": "<one of: low, medium, high, critical>"
}}
"""

    def _call_llm(self, prompt: str) -> str:
        try:
            response = self.client.chat.completions.create(
                model=self.deployment,
                messages=[
                    {"role": "system", "content": "You are a software visual analytics platform assistant. Output valid JSON only."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"Azure OpenAI LLM API call failed: {e}")
            return ""

    def _parse_json(self, raw_text: str) -> Optional[Dict[str, Any]]:
        if not raw_text:
            return None
        text = raw_text.strip()
        # Clean markdown code fences if present
        if text.startswith("```"):
            lines = text.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            text = "\n".join(lines).strip()
        try:
            data = json.loads(text)
            if isinstance(data, dict) and "summary" in data and "why_it_matters" in data:
                return data
        except Exception:
            pass
        return None

    def _heuristic_fallback(
        self,
        commit_sha: str,
        change_record: ChangeRecord,
        impact_subgraph: ImpactSubgraph,
        affected_count: int,
    ) -> Explanation:
        risk = self._determine_risk_level(change_record.change_type, affected_count)
        summary = f"{change_record.change_type.replace('_', ' ').title()} in {change_record.file}"
        why = f"Modifies AST structure ({change_record.ast_edit_summary}). Directly affects {len(impact_subgraph.direct_impacts)} symbols and transitively affects {len(impact_subgraph.transitive_impacts)} symbols."
        return Explanation(
            commit_sha=commit_sha,
            summary=summary,
            why_it_matters=why,
            affected_count=affected_count,
            risk_level=risk,
        )

    def _determine_risk_level(self, change_type: str, affected_count: int) -> str:
        if change_type in ("api_change", "logic_change") and affected_count > 5:
            return "critical"
        elif change_type in ("api_change", "logic_change") or affected_count > 2:
            return "high"
        elif change_type in ("refactor", "bug_fix_pattern"):
            return "medium"
        return "low"
