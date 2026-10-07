# SemantiX Backend

**SemantiX** is an AI-augmented visual analytics platform for semantic software evolution and dependency impact analysis.

## Stack Architecture
- **Language & Framework**: Python 3.11 / Python 3.12, FastAPI, Uvicorn
- **Parser**: Tree-sitter (`tree-sitter-python` + `tree-sitter-javascript`)
- **Graph Processing**: NetworkX directed graph analysis
- **AI / Semantic Layer**: Azure OpenAI GPT-4o (Explanations) & Azure OpenAI `text-embedding-3-large` (Code Embeddings)
- **Persistence**: SQLite with isolated Repository Pattern (DAL)
- **Git Access**: GitPython

---

## Project Structure

```text
Semantix/
├── semantix/
│   ├── models.py                # Domain entity models (Pydantic)
│   ├── ingestion/               # Module 1: Git repository walking & diff extraction
│   ├── semantic_diff/           # Module 2: Tree-sitter AST diffing, heuristics & embeddings
│   ├── dependency_graph/        # Module 3: NetworkX dependency graph & impact propagation
│   ├── explanation/             # Module 4: Azure OpenAI GPT-4o structured explainer
│   ├── storage/                 # Module 5: SQLite connection & Repository pattern DAL
│   └── api/                     # Module 6: FastAPI server & background job runner
├── tests/                       # Complete pytest suite (18 unit/integration tests)
├── .env.example                 # Environment configuration template
├── pytest.ini                   # Pytest path configuration
└── README.md                    # Setup and usage guide
```

---

## Getting Started

### 1. Installation

Install Python dependencies:
```bash
pip install -r requirements.txt # or:
pip install fastapi uvicorn GitPython networkx tree-sitter tree-sitter-python tree-sitter-javascript openai pytest httpx
```

### 2. Environment Configuration

Copy `.env.example` to `.env` and fill in your Azure OpenAI deployment credentials:
```bash
cp .env.example .env
```

If Azure OpenAI credentials are omitted, SemantiX runs gracefully in offline test mode using deterministic heuristic fallback models.

---

## Running the API Server

Start the server using Uvicorn:

```bash
uvicorn semantix.api.app:app --reload --host 0.0.0.0 --port 8000
```

The API will be accessible at:
- **Base URL**: `http://localhost:8000`
- **Interactive OpenAPI Docs**: `http://localhost:8000/docs`

---

## API Endpoints

### 1. Kick off Repository Analysis (Background Job)
- **`POST /repos/analyze`**
- **Request Body**:
  ```json
  {
    "repo_url_or_path": "./",
    "commit_depth": 100
  }
  ```
- **Response**: `202 Accepted`
  ```json
  {
    "job_id": "3f8b0306-613d-4f10-9b34-8c87e02df352",
    "status": "pending"
  }
  ```

### 2. Check Job Status
- **`GET /jobs/{job_id}`**
- **Response**:
  ```json
  {
    "job_id": "3f8b0306-613d-4f10-9b34-8c87e02df352",
    "status": "complete",
    "created_at": "2026-08-23T12:00:00",
    "completed_at": "2026-08-23T12:00:05",
    "error": null
  }
  ```

### 3. List Analyzed Commits
- **`GET /commits?limit=50&offset=0`**

### 4. Fetch Impact Subgraph for a Commit
- **`GET /commits/{sha}/impact`**

### 5. Fetch LLM Explanation for a Commit
- **`GET /commits/{sha}/explanation`**

### 6. View Semantic Hotspots
- **`GET /hotspots?limit=10`**

---

## Running Automated Tests

Run the full pytest suite:

```bash
pytest -v
```
