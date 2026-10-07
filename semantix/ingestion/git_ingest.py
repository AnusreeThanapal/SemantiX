"""Git repository ingestion logic using GitPython."""

import os
import logging
import tempfile
from typing import List, Optional
import git
from datetime import datetime

from semantix.models import Commit, ChangedFile

logger = logging.getLogger("semantix.ingestion")


class GitIngestor:
    """Ingests commits and changed file contents from a Git repository."""

    def __init__(self, repo_path_or_url: str):
        self.repo_path_or_url = repo_path_or_url
        self._temp_dir: Optional[tempfile.TemporaryDirectory] = None
        self.repo: git.Repo = self._init_repo(repo_path_or_url)

    def _init_repo(self, path_or_url: str) -> git.Repo:
        if os.path.exists(path_or_url) and os.path.isdir(path_or_url):
            logger.info("Opening local repository", extra={"repo_path": path_or_url})
            try:
                return git.Repo(path_or_url)
            except git.exc.InvalidGitRepositoryError:
                raise ValueError(f"Directory is not a valid git repository: {path_or_url}")
        elif path_or_url.startswith(("http://", "https://", "git@", "ssh://")):
            self._temp_dir = tempfile.TemporaryDirectory(prefix="semantix_repo_")
            target_dir = self._temp_dir.name
            logger.info("Cloning remote repository", extra={"url": path_or_url, "target_dir": target_dir})
            return git.Repo.clone_from(path_or_url, target_dir)
        else:
            raise ValueError(f"Invalid git repository path or URL: {path_or_url}")

    def get_commits(self, depth: int = 100) -> List[Commit]:
        """Walk commit history up to specified depth and extract changed files content."""
        commits_data: List[Commit] = []
        try:
            raw_commits = list(self.repo.iter_commits(max_count=depth))
        except git.GitCommandError as e:
            logger.error("Failed to iterate commits", extra={"error": str(e)})
            return []

        for commit in raw_commits:
            logger.info("Processing commit", extra={"sha": commit.hexsha, "stage": "ingestion"})
            changed_files: List[ChangedFile] = []

            # Compare against parent (or NULL_TREE if initial commit)
            if commit.parents:
                parent = commit.parents[0]
                diffs = parent.diff(commit)
            else:
                parent = None
                diffs = commit.diff(git.NULL_TREE, R=True)

            for diff_item in diffs:
                file_path = diff_item.b_path or diff_item.a_path
                if not file_path:
                    continue

                change_type = "modified"
                if diff_item.new_file:
                    change_type = "added"
                elif diff_item.deleted_file:
                    change_type = "deleted"
                elif diff_item.renamed_file:
                    change_type = "renamed"

                old_content = self._get_blob_content(parent, diff_item.a_path) if parent and not diff_item.new_file else None
                new_content = self._get_blob_content(commit, diff_item.b_path) if not diff_item.deleted_file else None

                changed_files.append(
                    ChangedFile(
                        file_path=file_path,
                        change_type=change_type,
                        old_content=old_content,
                        new_content=new_content,
                    )
                )

            author_str = f"{commit.author.name} <{commit.author.email}>" if commit.author else "Unknown"
            commit_time = datetime.fromtimestamp(commit.committed_date).isoformat()

            commits_data.append(
                Commit(
                    sha=commit.hexsha,
                    author=author_str,
                    timestamp=commit_time,
                    message=commit.message.strip(),
                    changed_files=changed_files,
                )
            )

        return commits_data

    def _get_blob_content(self, commit_or_tree, file_path: Optional[str]) -> Optional[str]:
        if not commit_or_tree or not file_path:
            return None
        try:
            blob = commit_or_tree.tree / file_path
            content = blob.data_stream.read()
            return content.decode("utf-8", errors="replace")
        except Exception:
            return None

    def close(self):
        if hasattr(self, "repo") and self.repo:
            try:
                self.repo.close()
            except Exception as e:
                logger.warning(f"Error closing Git repository instance: {e}")

        if self._temp_dir:
            temp_path = self._temp_dir.name
            try:
                self._temp_dir.cleanup()
            except Exception as e:
                logger.warning(f"Standard tempdir cleanup failed, attempting forced rmtree for {temp_path}: {e}")
                if os.path.exists(temp_path):
                    import shutil
                    import stat

                    def _on_error(func, path, _):
                        try:
                            os.chmod(path, stat.S_IWRITE)
                            func(path)
                        except Exception:
                            pass

                    try:
                        shutil.rmtree(temp_path, onerror=_on_error)
                    except Exception as err:
                        logger.error(f"Failed to remove temp git directory {temp_path}: {err}")

