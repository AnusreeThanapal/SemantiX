import os
import re
import math
import hashlib
import threading
from typing import List, Dict, Any, Optional

_service_instance: Optional['CodeBERTService'] = None
_service_lock = threading.Lock()


class CodeBERTService:
  """CodeBERT embedding service with lazy background warmup and heuristic fallback."""

  def __init__(self):
    self._lock = threading.Lock()
    self._state = 'unloaded'  # disabled | unloaded | loading | ready | fallback | error
    self._message = ''
    self._tokenizer = None
    self._model = None
    self._device = None

  def _is_enabled(self) -> bool:
    val = os.getenv('CODEBERT_ENABLED', 'true').strip().lower()
    return val not in ('false', '0', 'no', 'off')

  def status(self) -> Dict[str, Any]:
    """Returns current status without blocking or loading the model."""
    enabled = self._is_enabled()
    model_name = os.getenv('CODEBERT_MODEL_NAME', 'microsoft/codebert-base')
    device_cfg = os.getenv('CODEBERT_DEVICE', 'cpu')

    with self._lock:
      if not enabled:
        state = 'disabled'
        kind = 'fallback-heuristic'
        msg = 'CodeBERT is disabled via environment'
      else:
        state = self._state
        kind = 'codebert' if self._state == 'ready' else 'fallback-heuristic'
        msg = self._message

      device_str = str(self._device) if self._device else device_cfg

      return {
          'state': state,
          'kind': kind,
          'model_name': model_name,
          'device': device_str,
          'dim': 768,
          'message': msg,
      }

  def warmup(self) -> None:
    """Idempotently kicks off background loading of the CodeBERT model."""
    if not self._is_enabled():
      return

    with self._lock:
      if self._state in ('loading', 'ready', 'fallback'):
        return
      self._state = 'loading'
      self._message = 'Loading CodeBERT model and tokenizer in background'

    thread = threading.Thread(target=self._load_model_worker, daemon=True)
    thread.start()

  def _load_model_worker(self) -> None:
    try:
      import torch
      from transformers import AutoTokenizer, AutoModel

      device_str = os.getenv('CODEBERT_DEVICE', 'auto')
      if device_str == 'auto':
        if torch.cuda.is_available():
          dev = torch.device('cuda')
        elif (
            hasattr(torch.backends, 'mps')
            and torch.backends.mps.is_available()
        ):
          dev = torch.device('mps')
        else:
          dev = torch.device('cpu')
      else:
        dev = torch.device(device_str)

      model_name = os.getenv('CODEBERT_MODEL_NAME', 'microsoft/codebert-base')
      local_path = os.getenv('CODEBERT_LOCAL_PATH', '')
      kwargs = {}
      if local_path:
        model_name = local_path
        kwargs['local_files_only'] = True

      tokenizer = AutoTokenizer.from_pretrained(model_name, **kwargs)
      model = AutoModel.from_pretrained(model_name, **kwargs)
      model.eval()
      model.to(dev)

      with self._lock:
        self._tokenizer = tokenizer
        self._model = model
        self._device = dev
        self._state = 'ready'
        self._message = ''
    except Exception as exc:
      with self._lock:
        self._state = 'fallback'
        self._message = f'CodeBERT unavailable, using fallback: {exc}'

  def _fallback_embed(self, text: str) -> List[float]:
    """Deterministic hashed bag-of-identifier-tokens, 768-d, L2-normalised."""
    dim = 768
    tokens = re.findall(r'[A-Za-z0-9_]+', text)
    if not tokens:
      vec = [0.0] * dim
      vec[0] = 1.0
      return vec

    vec = [0.0] * dim
    for tok in tokens:
      h = hashlib.sha256(tok.encode('utf-8')).digest()
      idx = int.from_bytes(h[:4], 'big') % dim
      sign = 1.0 if (h[4] % 2 == 0) else -1.0
      vec[idx] += sign

    norm = math.sqrt(sum(x * x for x in vec))
    if norm > 0:
      return [x / norm for x in vec]
    vec = [0.0] * dim
    vec[0] = 1.0
    return vec

  def embed(self, texts: List[str]) -> List[List[float]]:
    """Generates L2-normalised 768-d embeddings for input texts."""
    if not texts:
      return []

    is_ready = False
    with self._lock:
      if self._is_enabled() and self._state == 'ready':
        is_ready = True

    if not is_ready:
      return [self._fallback_embed(t) for t in texts]

    # Real CodeBERT model forward pass
    try:
      import torch

      batch_size = int(os.getenv('CODEBERT_BATCH_SIZE', '8'))
      max_tokens = int(os.getenv('CODEBERT_MAX_TOKENS', '512'))

      results: List[List[float]] = []

      with self._lock:
        for i in range(0, len(texts), batch_size):
          batch = texts[i : i + batch_size]
          inputs = self._tokenizer(
              batch,
              padding=True,
              truncation=True,
              max_length=max_tokens,
              return_tensors='pt',
          ).to(self._device)

          with torch.inference_mode():
            outputs = self._model(**inputs)
            last_hidden = outputs.last_hidden_state
            mask = (
                inputs['attention_mask']
                .unsqueeze(-1)
                .expand(last_hidden.size())
                .float()
            )
            sum_embeddings = torch.sum(last_hidden * mask, dim=1)
            sum_mask = torch.clamp(mask.sum(dim=1), min=1e-9)
            mean_pooled = sum_embeddings / sum_mask
            norm = torch.norm(mean_pooled, p=2, dim=1, keepdim=True).clamp(
                min=1e-9
            )
            normalized = (mean_pooled / norm).cpu().tolist()
            results.extend(normalized)

      return results
    except Exception:
      # If runtime error occurs during inference, fallback seamlessly
      return [self._fallback_embed(t) for t in texts]

  def embed_long_text(self, text: str) -> List[float]:
    """Splits into at most 8 chunks (~1500 chars on line boundaries), embeds each, averages and re-normalises."""
    if not text:
      return self.embed([''])[0]

    lines = text.splitlines(keepends=True)
    chunks: List[str] = []
    curr_chunk: List[str] = []
    curr_len = 0

    for line in lines:
      if curr_len + len(line) > 1500 and curr_chunk:
        chunks.append(''.join(curr_chunk))
        curr_chunk = [line]
        curr_len = len(line)
      else:
        curr_chunk.append(line)
        curr_len += len(line)

    if curr_chunk:
      chunks.append(''.join(curr_chunk))

    # Cap at at most 8 chunks
    if len(chunks) > 8:
      merged: List[str] = []
      step = len(chunks) / 8.0
      for i in range(8):
        start_idx = int(round(i * step))
        end_idx = int(round((i + 1) * step))
        merged.append(''.join(chunks[start_idx:end_idx]))
      chunks = merged

    vectors = self.embed(chunks)
    dim = len(vectors[0])
    avg_vec = [sum(v[i] for v in vectors) / len(vectors) for i in range(dim)]
    norm = math.sqrt(sum(x * x for x in avg_vec))
    if norm > 0:
      return [x / norm for x in avg_vec]
    avg_vec = [0.0] * dim
    avg_vec[0] = 1.0
    return avg_vec


def get_codebert_service() -> CodeBERTService:
  """Returns the singleton instance of CodeBERTService."""
  global _service_instance
  if _service_instance is None:
    with _service_lock:
      if _service_instance is None:
        _service_instance = CodeBERTService()
  return _service_instance
