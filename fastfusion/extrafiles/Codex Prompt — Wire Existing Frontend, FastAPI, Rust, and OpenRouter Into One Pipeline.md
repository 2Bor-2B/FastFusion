I have an existing hackathon repository containing three components that were built separately:

1. an existing frontend built by teammates
2. a FastAPI backend
3. a Rust/Axum service that talks to OpenRouter

I want you to inspect the repository as it currently exists and make the **smallest necessary changes** to create a fully working end-to-end pipeline.

Do not redesign the project unnecessarily.

Do not replace working code.

Do not introduce SQL, PostgreSQL, Redis, Celery, Ollama, Langtrace, authentication, Docker, or additional infrastructure.

The immediate goal is simply:

```text
Frontend
    ↓
FastAPI
    ↓
Rust/Axum
    ↓
OpenRouter

OpenRouter
    ↓
Rust
    ↓
FastAPI
    ↓
Frontend
```

The frontend must never communicate directly with Rust or OpenRouter.

FastAPI is the public backend/API boundary.

Rust is the model execution and benchmarking service.

---

# EXISTING RUST SERVICE

The Rust service uses:

- Axum
- Tokio
- Reqwest
- Serde
- OpenRouter

It normally runs on:

```text
http://127.0.0.1:8001
```

It already has or is intended to have these endpoints:

```text
GET  /health

POST /run

POST /benchmark/stream
```

`POST /run` accepts approximately:

```json
{
  "model": "MODEL_ID",
  "prompt": "prompt",
  "reasoning_effort": "high"
}
```

and returns approximately:

```json
{
  "model": "...",
  "answer": "...",

  "reasoning": "...",

  "reasoning_details": [
    {
      "type": "reasoning.text",
      "text": "...",
      "index": 0
    }
  ],

  "usage": {},
  "latency_ms": 1234
}
```

The fields:

```text
reasoning
reasoning_details
```

are extremely important.

Do not remove, summarize, modify, normalize, reorder, or discard them.

The application is specifically intended to inspect OpenRouter reasoning telemetry.

---

# RUST BENCHMARK

The Rust benchmark endpoint is:

```text
POST /benchmark/stream
```

It accepts approximately:

```json
{
  "models": [
    "MODEL_A",
    "MODEL_B"
  ],

  "reasoning_effort": "high",

  "cases": [
    {
      "id": "logic-1",
      "prompt": "..."
    },
    {
      "id": "planning-1",
      "prompt": "..."
    }
  ]
}
```

Rust executes model/case combinations concurrently.

The benchmark response is **NDJSON streaming**, not one final JSON array.

For example:

```json
{"type":"result","record":{"model":"MODEL_B","case_id":"logic-1","answer":"...","reasoning":"...","reasoning_details":[],"usage":{},"latency_ms":2100,"score":{"total":82.4}}}
{"type":"result","record":{"model":"MODEL_A","case_id":"logic-1","answer":"...","reasoning":"...","reasoning_details":[],"usage":{},"latency_ms":5300,"score":{"total":71.2}}}
{"type":"done","total_runs":2}
```

Individual results must be forwarded to the frontend as soon as they arrive.

Do NOT buffer the whole benchmark before responding.

---

# EXISTING FASTAPI BACKEND

The FastAPI backend likely lives in a directory such as:

```text
backend/
├── main.py
├── schemas.py
├── rust_client.py
└── ...
```

It runs approximately with:

```bash
uvicorn main:app --reload --port 8000
```

and therefore normally listens on:

```text
http://127.0.0.1:8000
```

Do not assume there is an `app/` Python package.

Inspect the real repository structure first and use imports that match it.

The previous project had an import issue caused by assuming:

```python
from app.schemas import ...
```

when `main.py`, `schemas.py`, and `rust_client.py` were actually siblings.

Avoid repeating that mistake.

---

# FASTAPI RESPONSIBILITIES

FastAPI should expose at minimum:

```text
GET  /health

POST /api/run

POST /api/benchmark
```

## `/api/run`

This should proxy:

```text
FastAPI /api/run
       ↓
Rust /run
```

It should pass the request JSON to Rust and return Rust's response JSON without unnecessarily changing it.

Example:

```python
async def run_model(payload: dict) -> dict:
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            "http://127.0.0.1:8001/run",
            json=payload,
        )

        response.raise_for_status()

        return response.json()
```

---

# FASTAPI BENCHMARK PROXY

The FastAPI backend must preserve streaming.

The intended flow is:

```text
Frontend
    ↓

POST /api/benchmark

    ↓

FastAPI opens streaming connection to:

POST Rust /benchmark/stream

    ↓

Rust emits NDJSON

    ↓

FastAPI relays each NDJSON event immediately

    ↓

Frontend updates live
```

A suitable Rust client implementation is approximately:

```python
import json
import httpx


RUST_URL = "http://127.0.0.1:8001"


async def benchmark_stream(payload: dict):
    async with httpx.AsyncClient(
        timeout=None
    ) as client:

        async with client.stream(
            "POST",
            f"{RUST_URL}/benchmark/stream",
            json=payload,
        ) as response:

            response.raise_for_status()

            async for line in response.aiter_lines():
                if not line:
                    continue

                yield json.loads(line)
```

And FastAPI should relay it approximately like:

```python
@app.post("/api/benchmark")
async def benchmark(request: BenchmarkRequest):

    async def stream():
        async for event in benchmark_stream(
            request.model_dump()
        ):
            yield json.dumps(event) + "\n"

    return StreamingResponse(
        stream(),
        media_type="application/x-ndjson",
    )
```

Preserve the streaming semantics.

---

# PYDANTIC REQUEST TYPES

Use request validation, but do not unnecessarily type every response coming from Rust.

Something approximately like:

```python
class RunRequest(BaseModel):
    model: str
    prompt: str
    reasoning_effort: str = "high"


class BenchmarkCase(BaseModel):
    id: str
    prompt: str


class BenchmarkRequest(BaseModel):
    models: list[str]
    cases: list[BenchmarkCase]
    reasoning_effort: str = "high"
```

Rust/OpenRouter responses may evolve.

Do not make Pydantic models that accidentally discard unknown reasoning fields.

---

# CORS

The frontend is likely running with Vite or another local development server.

Configure FastAPI CORS for likely local development origins such as:

```text
http://localhost:5173
http://127.0.0.1:5173

http://localhost:3000
http://127.0.0.1:3000
```

If the actual frontend uses a different port, detect it from the repository configuration and use the correct one.

Do not set an unnecessarily permissive production CORS policy if the actual origin can be determined.

---

# FRONTEND

Inspect the frontend before changing it.

Determine:

- framework
- build tool
- existing API abstraction
- existing state-management approach
- components already intended for model results or benchmarks
- environment variable conventions

Prefer adapting existing frontend patterns rather than creating parallel architecture.

The frontend should only call FastAPI, approximately:

```text
http://localhost:8000/api/run

http://localhost:8000/api/benchmark
```

Do not expose:

```text
http://localhost:8001
```

to frontend application code unless it is strictly for local debugging.

---

# FRONTEND SINGLE-RUN API

Create or adapt an API helper approximately like:

```typescript
export async function runModel(request: RunRequest) {
    const response = await fetch(
        `${API_URL}/api/run`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
            },

            body: JSON.stringify(request),
        }
    );

    if (!response.ok) {
        throw new Error(
            `Backend returned ${response.status}`
        );
    }

    return await response.json();
}
```

Use the project's existing environment variable convention for `API_URL`.

For example, if using Vite, prefer something such as:

```text
VITE_API_URL=http://localhost:8000
```

rather than hardcoding the URL throughout the application.

---

# FRONTEND BENCHMARK STREAM

The frontend benchmark must consume NDJSON incrementally.

Do NOT use:

```typescript
await response.json()
```

for `/api/benchmark`.

That would wait for the benchmark to finish.

Instead use the browser `ReadableStream`.

Implement or adapt something approximately like:

```typescript
export async function runBenchmark(
    request: BenchmarkRequest,
    onEvent: (event: any) => void,
) {
    const response = await fetch(
        `${API_URL}/api/benchmark`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
            },

            body: JSON.stringify(request),
        }
    );

    if (!response.ok) {
        throw new Error(
            `Benchmark failed: ${response.status}`
        );
    }

    if (!response.body) {
        throw new Error(
            "Response body is not streamable"
        );
    }

    const reader =
        response.body.getReader();

    const decoder =
        new TextDecoder();

    let buffer = "";

    while (true) {
        const {
            value,
            done,
        } = await reader.read();

        if (done) {
            break;
        }

        buffer += decoder.decode(
            value,
            {
                stream: true,
            }
        );

        const lines =
            buffer.split("\n");

        buffer =
            lines.pop() ?? "";

        for (const line of lines) {
            if (!line.trim()) {
                continue;
            }

            onEvent(
                JSON.parse(line)
            );
        }
    }

    if (buffer.trim()) {
        onEvent(
            JSON.parse(buffer)
        );
    }
}
```

Integrate this with the frontend's existing state-management style.

---

# FRONTEND RESULT HANDLING

Expected benchmark events include:

```json
{
  "type": "result",
  "record": {
    "model": "...",
    "case_id": "...",
    "answer": "...",

    "reasoning": "...",

    "reasoning_details": [...],

    "usage": {...},

    "latency_ms": 1234,

    "score": {
      "total": 82.4
    }
  }
}
```

and:

```json
{
  "type": "error",
  "model": "...",
  "case_id": "...",
  "error": "..."
}
```

and:

```json
{
  "type": "done",
  "total_runs": 6
}
```

As each `"result"` event arrives, update the UI immediately.

Do not wait for `"done"` to show results.

---

# UI GOAL

Do not rebuild my teammates' frontend.

Use the existing design.

But ensure that the existing UI can eventually display at least:

```text
Model
Case
Score
Latency
Final answer
Reasoning
Raw reasoning_details JSON
```

If there are already suitable cards/panels/tables, connect them.

If no suitable component exists, add only the smallest necessary UI.

For reasoning details, an expandable panel is sufficient:

```text
Reasoning
Raw JSON
```

Do not spend excessive time redesigning visuals.

Pipeline functionality matters more.

---

# IMPORTANT DATA-INTEGRITY REQUIREMENT

The application's purpose depends on OpenRouter reasoning telemetry.

Therefore, from Rust through FastAPI through the frontend, preserve:

```text
reasoning
reasoning_details
usage
model
answer
latency_ms
score
case_id
```

Do not alter `reasoning_details`.

Do not flatten it.

Do not summarize it.

Do not transform it into strings unnecessarily.

Do not discard unknown JSON fields.

The frontend should receive the same reasoning-details structure Rust received.

---

# ERROR HANDLING

Make errors understandable at each boundary.

For example:

## Rust unavailable

FastAPI should return or stream a useful error instead of crashing.

## OpenRouter model failure

Rust benchmark events already support:

```json
{
  "type": "error",
  "model": "...",
  "case_id": "...",
  "error": "..."
}
```

Relay that unchanged.

## Frontend

Surface benchmark failures in existing error UI or console in a way that does not crash the entire page.

One failed model must not destroy results from other models.

---

# DO NOT DO THESE THINGS

Do not:

- add a database
- add SQLAlchemy
- add Ollama
- add Langtrace
- add Redis
- add Celery
- add WebSockets unless the current HTTP streaming approach genuinely cannot work
- rewrite the Rust OpenRouter client
- replace the frontend framework
- introduce a new frontend state library unnecessarily
- refactor unrelated code
- change reasoning JSON formats
- make the frontend communicate directly with OpenRouter
- expose the OpenRouter API key in frontend code
- move the OpenRouter API key out of the Rust/server environment

---

# IMPLEMENTATION PROCESS

First inspect the repository.

Before modifying code, identify:

1. actual Rust project path
2. actual FastAPI project path
3. actual frontend project path
4. frontend framework/build tool
5. frontend dev-server port
6. existing frontend API helper files
7. existing backend imports and package structure
8. actual Rust endpoint names
9. actual benchmark request and response structs

Then wire the existing components together.

Do not blindly assume the example paths above exactly match the repository.

Adapt to the real code.

---

# VALIDATION

After implementing the pipeline, verify it incrementally.

## Rust

Ensure:

```bash
cargo check
```

passes.

Ensure:

```text
GET http://127.0.0.1:8001/health
```

works.

Ensure `/run` works.

Ensure `/benchmark/stream` emits NDJSON progressively.

---

## FastAPI

Ensure:

```text
GET http://127.0.0.1:8000/health
```

works.

Ensure:

```text
POST /api/run
```

successfully calls Rust.

Ensure:

```text
POST /api/benchmark
```

streams Rust NDJSON rather than buffering it.

---

## Frontend

Ensure:

- development server starts
- browser does not produce CORS errors
- one-model request works
- benchmark request works
- benchmark results appear incrementally
- `reasoning` reaches the browser
- `reasoning_details` reaches the browser as structured JSON
- Rust/OpenRouter errors are surfaced sensibly

---

# END-TO-END TEST

The final working system should allow this sequence:

```text
User clicks "Run Benchmark"

        ↓

Frontend sends:

POST FastAPI /api/benchmark

        ↓

FastAPI sends:

POST Rust /benchmark/stream

        ↓

Rust concurrently calls multiple OpenRouter models

        ↓

Model B finishes

        ↓

Rust emits NDJSON result for B

        ↓

FastAPI immediately relays B

        ↓

Frontend immediately displays B

        ↓

Model A finishes later

        ↓

Rust emits A

        ↓

FastAPI relays A

        ↓

Frontend displays A

        ↓

Rust emits "done"

        ↓

Frontend marks benchmark complete
```

The reasoning JSON for every result must survive this complete path unchanged.

---

# OUTPUT FROM YOU

After implementing the changes:

1. briefly summarize what files you changed
2. explain the final request/data flow
3. give the exact commands to run:
   - Rust
   - FastAPI
   - frontend
4. give one curl command to test FastAPI `/api/run`
5. give one curl command to test FastAPI `/api/benchmark`
6. report any remaining assumptions or broken parts

Most importantly: **actually inspect and modify the existing repository rather than merely giving me sample code.**