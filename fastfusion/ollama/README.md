# Running the Local Reasoning Analyzer

This service provides a simple FastAPI endpoint that sends AI reasoning text to a local Ollama model and returns:

- Logical reasoning chunks
- A concise summary of the overall reasoning process

## 1. Requirements

Make sure you have:

- Python 3.11 or newer
- Ollama installed
- The `llama3.1:8b` model available locally

## 2. Install Python Dependencies

Install the required Python packages:

```bash
pip install fastapi uvicorn httpx pydantic
```

## 3. Start Ollama

If Ollama is not already running, start the Ollama service:

```bash
ollama serve
```

Keep this terminal open while the backend is running.

## 4. Download the Model

Pull the required model:

```bash
ollama pull llama3.1:8b
```

You only need to do this once.

You can verify that the model is installed with:

```bash
ollama list
```

## 5. Start the FastAPI Backend

From the directory containing `main.py`, run:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The backend should now be available at:

```text
http://localhost:8000
```

## 6. Open the API Documentation

FastAPI automatically provides an interactive API testing interface.

Open:

```text
http://localhost:8000/docs
```

Select the `POST /analyze` endpoint and click **Try it out**.

Example request:

```json
{
  "reasoning": "First, I identified the requirements of the problem. I considered using a cloud model, but this would introduce latency and API cost. I then considered a local model. Since the task only requires summarization, the local model provides sufficient quality while reducing latency and cost. Therefore, I selected the local model."
}
```

A successful response should look similar to:

```json
{
  "chunks": [
    {
      "title": "Identify the requirements",
      "content": "The model first determines the main requirements and constraints of the problem."
    },
    {
      "title": "Compare deployment options",
      "content": "The model compares cloud and local model deployment based on latency, cost, and required capability."
    },
    {
      "title": "Select the local approach",
      "content": "The model determines that a local model provides sufficient quality while reducing latency and cost."
    }
  ],
  "summary": "The reasoning identifies the main constraints, compares cloud and local deployment options, and selects the local model as the best balance between quality, latency, and cost."
}
```

## 7. Test the API with curl

You can also test the endpoint directly from the terminal:

```bash
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "reasoning": "First, I identified the requirements of the problem. I considered using a cloud model, but this would introduce latency and API cost. I then considered a local model. Since the task only requires summarization, the local model provides sufficient quality while reducing latency and cost. Therefore, I selected the local model."
  }'
```

## Request Flow

```text
Reasoning Text
      ↓
POST /analyze
      ↓
FastAPI Backend
      ↓
Ollama /api/chat
      ↓
llama3.1:8b
      ↓
Structured JSON
      ↓
Chunks + Summary
```

## Default Ports

| Service | Address |
|---|---|
| FastAPI | `http://localhost:8000` |
| Swagger UI | `http://localhost:8000/docs` |
| Ollama | `http://localhost:11434` |

## Troubleshooting

If the backend reports that it cannot connect to Ollama, make sure Ollama is running:

```bash
ollama serve
```

If the model cannot be found, pull it again:

```bash
ollama pull llama3.1:8b
```

If port `8000` is already in use, start FastAPI on another port:

```bash
uvicorn main:app --reload --port 8001
```