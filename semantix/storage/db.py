"""SQLite database connection and schema setup."""

import os
import sqlite3
import logging

logger = logging.getLogger("semantix.storage.db")

DEFAULT_DB_PATH = os.getenv("SEMANTIX_DB_PATH", "semantix.db")


def get_db_connection(db_path: str = DEFAULT_DB_PATH) -> sqlite3.Connection:
    """Returns a SQLite connection with row factory enabled."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path: str = DEFAULT_DB_PATH):
    """Create database tables if they do not exist."""
    logger.info(f"Initializing SQLite database schema at {db_path}")
    conn = get_db_connection(db_path)
    cursor = conn.cursor()

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS commits (
            sha TEXT PRIMARY KEY,
            author TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            message TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS changed_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            commit_sha TEXT NOT NULL,
            file_path TEXT NOT NULL,
            change_type TEXT NOT NULL,
            old_content TEXT,
            new_content TEXT,
            FOREIGN KEY (commit_sha) REFERENCES commits (sha)
        );

        CREATE TABLE IF NOT EXISTS change_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            commit_sha TEXT NOT NULL,
            file TEXT NOT NULL,
            change_type TEXT NOT NULL,
            confidence REAL NOT NULL,
            ast_edit_summary TEXT NOT NULL,
            embedding_similarity REAL,
            FOREIGN KEY (commit_sha) REFERENCES commits (sha)
        );

        CREATE TABLE IF NOT EXISTS impact_subgraphs (
            commit_sha TEXT NOT NULL,
            file_path TEXT NOT NULL DEFAULT '',
            changed_node TEXT NOT NULL,
            direct_impacts TEXT NOT NULL, -- JSON array
            transitive_impacts TEXT NOT NULL, -- JSON array
            PRIMARY KEY (commit_sha, file_path),
            FOREIGN KEY (commit_sha) REFERENCES commits (sha)
        );

        CREATE TABLE IF NOT EXISTS explanations (
            commit_sha TEXT NOT NULL,
            file_path TEXT NOT NULL DEFAULT '',
            summary TEXT NOT NULL,
            why_it_matters TEXT NOT NULL,
            affected_count INTEGER NOT NULL,
            risk_level TEXT NOT NULL,
            PRIMARY KEY (commit_sha, file_path),
            FOREIGN KEY (commit_sha) REFERENCES commits (sha)
        );

        CREATE TABLE IF NOT EXISTS jobs (
            job_id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            error TEXT
        );

        CREATE TABLE IF NOT EXISTS embeddings_cache (
            content_hash TEXT PRIMARY KEY,
            embedding_json TEXT NOT NULL
        );
    """)

    conn.commit()
    conn.close()
