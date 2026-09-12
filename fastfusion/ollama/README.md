# AI Reasoning Chunk & Summary Backend

A minimal FastAPI backend that decomposes AI reasoning chains into meaningful logical chunks and produces an overall summary using a local Ollama model (`llama3.1:8b`) with structured JSON outputs.

## Architecture & Flow

```text
reasoning text
     ↓
POST /analyze
     ↓
FastAPI
     ↓
Ollama /api/chat (format: JSON Schema, stream: false, temperature: 0)
     ↓
structured JSON
     ↓
FastAPI response (validated via Pydantic)
```

1. **Client Request**: The client sends a JSON payload with a `reasoning` string to `POST /analyze`.
2. **Ollama Chat Request**: FastAPI constructs an async HTTP POST request using `httpx` to `http://localhost:11434/api/chat` using `llama3.1:8b`. A strict JSON Schema derived from the Pydantic `AnalyzeResponse` model is passed in the `format` field.
3. **Structured Generation**: Ollama enforces schema constraints at `temperature: 0` to produce deterministic logical chunks and a summary.
4. **Validation & Response**: FastAPI validates the returned JSON string against `AnalyzeResponse` and sends the validated payload back to the client.

## Setup & Running

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Start Ollama and Pull Model
```bash
# Start Ollama service (if not already running)
ollama serve

# Pull the required model
ollama pull llama3.1:8b
```

### 3. Run the FastAPI Server
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 4. Test the API
```bash
curl -X POST "http://localhost:8000/analyze" \
  -H "Content-Type: application/json" \
  -d '{
    "reasoning": "The user wants an algorithm to find if a cycle exists in a linked list. Let us consider possible constraints such as O(1) extra memory. One approach is using a hash table of visited nodes, which requires O(n) memory. Another approach is Floyd cycle-finding algorithm using two pointers (slow and fast). The slow pointer moves one step while fast moves two. If they meet, a cycle exists. This satisfies O(1) space and O(n) time. Therefore, Floyd cycle-finding is the optimal choice."
  }'
```
