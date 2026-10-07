"""Background pipeline runner executing ingestion -> diff -> graph -> explanation -> storage."""

import logging
from datetime import datetime, UTC
from typing import Optional

from semantix.models import AnalysisJob
from semantix.ingestion.git_ingest import GitIngestor
from semantix.semantic_diff.diff_pipeline import SemanticDiffPipeline
from semantix.dependency_graph import DependencyGraphBuilder, ImpactAnalyzer
from semantix.explanation.llm_explainer import LLMExplainer
from semantix.storage.repository import SQLiteRepository

logger = logging.getLogger("semantix.api.pipeline_runner")


def run_analysis_pipeline(
    job_id: str,
    repo_url_or_path: str,
    commit_depth: int = 100,
    hop_limit: int = 3,
    db_path: str = "semantix.db",
):
    """Executes full SemantiX analytics pipeline as a background job."""
    repo = SQLiteRepository(db_path=db_path)
    
    # 1. Update job to running
    job = repo.get_job(job_id) or AnalysisJob(
        job_id=job_id, status="running", created_at=datetime.now(UTC).isoformat()
    )
    job.status = "running"
    repo.save_job(job)

    ingestor: Optional[GitIngestor] = None
    try:
        logger.info(f"Starting analysis job {job_id} for repo {repo_url_or_path}")

        # Stage 1: Ingestion
        ingestor = GitIngestor(repo_url_or_path)
        commits = ingestor.get_commits(depth=commit_depth)

        for commit in commits:
            repo.save_commit(commit)

        # Build repository code snapshot map for static dependency graph
        file_contents = {}
        for commit in reversed(commits):
            for cf in commit.changed_files:
                if cf.new_content is not None:
                    file_contents[cf.file_path] = cf.new_content

        # Stage 2: Dependency Graph Construction
        graph_builder = DependencyGraphBuilder()
        graph = graph_builder.build_graph_for_files(file_contents)

        # Pipelines
        diff_pipeline = SemanticDiffPipeline()
        impact_analyzer = ImpactAnalyzer()
        llm_explainer = LLMExplainer()

        # Stage 3, 4, 5: Diffing, Impact Subgraph & LLM Explanation per commit & file
        for commit in commits:
            change_records = diff_pipeline.process_commit(commit)
            repo.save_change_records(change_records)

            for cr in change_records:
                impact_subgraph = impact_analyzer.compute_impact(graph, cr, hop_limit=hop_limit)
                impact_subgraph.commit_sha = commit.sha
                impact_subgraph.file_path = cr.file
                repo.save_impact_subgraph(commit.sha, impact_subgraph, file_path=cr.file)

                code_window = cr.ast_edit_summary
                explanation = llm_explainer.generate_explanation(
                    commit.sha, cr, impact_subgraph, code_window
                )
                explanation.file_path = cr.file
                repo.save_explanation(explanation, file_path=cr.file)

        # Mark job complete
        job.status = "complete"
        job.completed_at = datetime.now(UTC).isoformat()
        repo.save_job(job)
        logger.info(f"Completed analysis job {job_id} successfully.")

    except Exception as e:
        logger.error(f"Analysis job {job_id} failed: {e}", exc_info=True)
        job.status = "failed"
        job.error = str(e)
        job.completed_at = datetime.now(UTC).isoformat()
        repo.save_job(job)

    finally:
        if ingestor:
            try:
                ingestor.close()
            except Exception as close_err:
                logger.warning(f"Error during ingestor close: {close_err}")

