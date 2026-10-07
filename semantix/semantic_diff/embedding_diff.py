"""Azure OpenAI embedding diff analyzer with hash caching."""

import os
import hashlib
import math
import logging
from typing import Dict, List, Optional, Tuple
from openai import AzureOpenAI

logger = logging.getLogger("semantix.semantic_diff.embedding_diff")


def compute_content_hash(file_path: str, content: str) -> str:
    """Compute sha256 hash for caching embeddings."""
    hasher = hashlib.sha256()
    hasher.update(file_path.encode("utf-8"))
    hasher.update(content.encode("utf-8"))
    return hasher.hexdigest()


def cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    """Compute cosine similarity between two float vectors."""
    if not vec1 or not vec2 or len(vec1) != len(vec2):
        return 0.0
    dot_product = sum(a * b for a, b in zip(vec1, vec2))
    norm_a = math.sqrt(sum(a * a for a in vec1))
    norm_b = math.sqrt(sum(b * b for b in vec2))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot_product / (norm_a * norm_b)


class EmbeddingDiffAnalyzer:
    """Computes code embedding similarity using Azure OpenAI text-embedding-3-large with local caching."""

    def __init__(self, cache_store: Optional[Dict[str, List[float]]] = None):
        self._cache: Dict[str, List[float]] = cache_store if cache_store is not None else {}
        
        # Read env variables
        self.endpoint = os.getenv("AZURE_OPENAI_EMBEDDING_ENDPOINT") or os.getenv("AZURE_OPENAI_ENDPOINT")
        self.api_key = os.getenv("AZURE_OPENAI_EMBEDDING_KEY") or os.getenv("AZURE_OPENAI_KEY")
        self.deployment = os.getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "text-embedding-3-large")
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
                logger.warning(f"Failed to initialize AzureOpenAI embedding client: {e}")

    def get_embedding(self, file_path: str, content: str) -> Optional[List[float]]:
        """Fetch or calculate vector embedding for code content."""
        if not content or not content.strip():
            return None

        content_hash = compute_content_hash(file_path, content)
        if content_hash in self._cache:
            logger.debug(f"Embedding cache hit for {file_path}")
            return self._cache[content_hash]

        if not self.client:
            # Fallback mock embedding generator for test/offline environments
            mock_vec = self._generate_mock_embedding(content)
            self._cache[content_hash] = mock_vec
            return mock_vec

        try:
            response = self.client.embeddings.create(
                model=self.deployment,
                input=content[:8000],  # Truncate to stay safely within token limits
            )
            embedding = response.data[0].embedding
            self._cache[content_hash] = embedding
            return embedding
        except Exception as e:
            logger.warning(f"Azure OpenAI embedding call failed for {file_path}: {e}")
            # Fallback on failure
            mock_vec = self._generate_mock_embedding(content)
            self._cache[content_hash] = mock_vec
            return mock_vec

    def compute_similarity(
        self, file_path: str, old_code: Optional[str], new_code: Optional[str]
    ) -> Optional[float]:
        """Compute cosine similarity score between old and new code versions."""
        if old_code is None or new_code is None:
            return 0.0

        vec_old = self.get_embedding(file_path, old_code)
        vec_new = self.get_embedding(file_path, new_code)

        if not vec_old or not vec_new:
            return None

        sim = cosine_similarity(vec_old, vec_new)
        return round(sim, 4)

    def _generate_mock_embedding(self, content: str, dim: int = 128) -> List[float]:
        """Deterministic mock embedding for offline testing based on character frequencies."""
        vec = [0.0] * dim
        for i, char in enumerate(content):
            vec[ord(char) % dim] += 1.0
        norm = math.sqrt(sum(v * v for v in vec))
        return [v / norm for v in vec] if norm > 0 else vec
