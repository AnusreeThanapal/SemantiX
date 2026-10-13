import threading
from typing import Tuple, Dict, Any
import networkx as nx

from semantix.storage.db import get_db_connection
from semantix.dependency_graph import DependencyGraphBuilder

_cache: Dict[Tuple[str, int, Any], Tuple[nx.DiGraph, Dict[str, str]]] = {}
_lock = threading.Lock()

CODE_EXTENSIONS = ('.py', '.pyw', '.js', '.jsx', '.mjs', '.cjs')


def get_snapshot(db_path: str) -> Tuple[nx.DiGraph, Dict[str, str]]:
    with _lock:
        conn = get_db_connection(db_path)
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*), MAX(id) FROM changed_files")
            row = cursor.fetchone()
            count_val = row[0] if row else 0
            max_id_val = row[1] if row else None
            cache_key = (db_path, count_val, max_id_val)

            if cache_key in _cache:
                return _cache[cache_key]

            cursor.execute("""
                SELECT cf.file_path, cf.new_content 
                FROM changed_files cf 
                JOIN commits c ON c.sha=cf.commit_sha
                WHERE cf.new_content IS NOT NULL 
                ORDER BY c.timestamp DESC, cf.id DESC
            """)
            rows = cursor.fetchall()
            file_contents: Dict[str, str] = {}
            for r in rows:
                fpath = r[0]
                content = r[1]
                if fpath not in file_contents:
                    if any(fpath.endswith(ext) for ext in CODE_EXTENSIONS):
                        file_contents[fpath] = content
                    else:
                        file_contents[fpath] = ""

            builder = DependencyGraphBuilder()
            graph = builder.build_graph_for_files(file_contents)
            _cache[cache_key] = (graph, file_contents)
            return graph, file_contents
        finally:
            conn.close()
