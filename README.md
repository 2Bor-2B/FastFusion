# FastFusion

FastFusion compares reasoning models on one question and grows the results into a knowledge map.

Submit a question and FastFusion:

1. runs it against several OpenRouter reasoning models in parallel;
2. scores each run on a 100-point scale computed in Rust (correctness, reasoning visibility, reasoning richness, latency);
3. picks the winner;
4. asks local Ollama, through FastAPI, to map the winner's exposed reasoning telemetry into readable snippets;
5. shows everything on a pan/zoom canvas that branches into a mind map as you ask follow-up questions.

Ticked canvas nodes are sent back through FastAPI so local Ollama can generate validated, reusable skills for Markdown export.

## Using the canvas

The page opens with only the command bar. After the first prompt the canvas, the top bar and the
activity panel appear.

| Action | How |
| --- | --- |
| Submit | Enter. Shift + Enter inserts a line break, and IME composition is respected. |
| Focus the input | Ctrl / Cmd + K. |
| Branch a follow-up | Select a finished block (click it, or press Continue on it), then ask. The new block is placed to its right and joined by an arrow. The command bar shows which block you are continuing from. |
| Pan | Drag the background, or two-finger scroll. |
| Zoom | The zoom controls, Fit all nodes, or Ctrl / Cmd + scroll. |
| Move a block | Drag it by its header. |
| Inspect a run | Click the RAW RESPONSE sheet peeking above a block. It slides over the card to show the original prompt and the raw JSON; Return to summary slides it back. |
| Watch the models | The activity panel shows each model, its answer, its score, and the winner. Escape collapses it. |
| Generate skills | Tick the download icon in a block footer, then press Generate Skills. The selected block snippets are sent to local Ollama and the validated skills are downloaded as Markdown. |
| Stop / retry | The square button stops a run; a stopped or failed block offers Try again. |
| Name the canvas | Double-click the name in the top bar. Enter commits, Escape discards, an empty name falls back to Untitled canvas. |
| Save / load | The disk icon writes `<canvas name>.json`; the folder icon reads one back and takes its name from the file. The folder icon stays available on an empty canvas. |
| Clear | The reset button empties the canvas and forgets the autosave. |

The canvas autosaves to the browser's local storage, so a reload comes back to the same
blocks at the same position, zoom and name. A run that was still going when the page went away
comes back as stopped and can be retried. Storage is per browser and per origin; use
save and load to move a canvas between machines.

## Architecture

```text
Frontend (Vite + React, dev server :5173)
   │  POST /api/benchmark, /api/reasoning/parse, /api/skills/generate (dev proxy)
   ▼
FastAPI backend (:8000)
   ├── Rust benchmark_serializer (:8001) → OpenRouter (benchmark stream)
   └── local Ollama (:11434) (reasoning blocks and generated skills)
```

One API key in total: `OPENROUTER_API_KEY`, read by the Rust service. The frontend and FastAPI never talk to OpenRouter.

## Running it

Start the layers in dependency order: Rust, then FastAPI, then the frontend.

### 1. Rust benchmark service

Create `fastfusion/benchmark_serializer/.env`:

```text
OPENROUTER_API_KEY=sk-or-...
# optional:
# OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
# RUST_LOG=info
```

Then `cd fastfusion/benchmark_serializer && cargo run`. The service listens on `0.0.0.0:8001`.

### 2. FastAPI backend

`main.py` uses bare `from schemas import ...`, so uvicorn must be started **from inside** `fastfusion/backend`:

```sh
cd fastfusion/backend
# with uv (no venv setup needed)
uv run --with fastapi --with 'uvicorn[standard]' --with httpx uvicorn main:app --port 8000
# or with pip
pip install -r requirements.txt && uvicorn main:app --reload --port 8000
```

It proxies to the Rust service at `http://127.0.0.1:8001` and exposes `GET /health`, `POST /api/run` and `POST /api/benchmark`.

### 3. Frontend

```sh
cd frontend
npx pnpm install   # or `pnpm install` if pnpm is on your PATH
npx pnpm dev       # http://localhost:5173
npx pnpm test      # vitest
```

Environment variables (`frontend/.env.local` or the shell):

| Variable | Effect |
| --- | --- |
| `VITE_USE_MOCK=true` | Run the UI with built-in mock data and no backend (the test suite sets this). |
| `VITE_API_TARGET` | Dev-proxy target for `/api`. Default `http://127.0.0.1:8000`. Read from the shell, not from `.env`. |
| `VITE_API_BASE` | Backend origin for production builds. Empty (default) = same origin. |

## Models

The UI currently benchmarks these three free models:

- `nex-agi/nex-n2.5-mini:free`
- `nex-agi/nex-n2.5-pro:free`
- `nvidia/nemotron-3-ultra-550b-a55b:free`

Change them in `frontend/src/agents.ts`, where each model also gets its display name, role and avatar colour.
The Rust service accepts any OpenRouter model id, so no backend change is needed.

## Benchmark stream contract

```text
REQUEST — POST /benchmark/stream on the Rust service (and POST /api/benchmark on FastAPI, which forwards the body unchanged and streams the response lines back unchanged):
{
  "models": ["nex-agi/nex-n2.5-mini:free", "nex-agi/nex-n2.5-pro:free", "nvidia/nemotron-3-ultra-550b-a55b:free"],
  "cases": [{"id": "trace-1757600000000", "category": "user", "prompt": "<user question>", "expected_contains": null}],
  "reasoning_effort": "high"
}
- expected_contains may be null (free-form questions have no reference answer, so correct = null and correctness_score = 0).

RESPONSE — application/x-ndjson, one JSON object per line, each terminated by "\n". Order: zero or more result/error lines as each (model, case) run finishes (arbitrary order, because they run concurrently), followed by exactly one done line.
{"type":"result","record":{"model":"<model id>","case_id":"trace-…","category":"user","answer":"<string|null>","reasoning":"<string|null>","reasoning_details":<json>,"usage":<json>,"latency_ms":1234,"correct":null,"score":{"total":57.5,"correctness_score":0,"visibility_score":30,"richness_score":12.5,"latency_score":15,"reasoning_visible":true,"reasoning_chars":1875,"has_plaintext_reasoning":true,"has_summary_reasoning":false,"has_encrypted_reasoning":false}}}
{"type":"error","model":"<model id>","case_id":"trace-…","error":"<message>"}
{"type":"done","total_runs":3}

After the stream completes, the frontend picks the highest score (then lowest latency), sends that winner's untouched reasoning telemetry to `POST /api/reasoning/parse`, and maps the validated snippets into the canvas block. Ollama is never part of the benchmark stream. If Ollama is offline, the block falls back to the winning answer and keeps the semantic error in its raw payload.
```

## Troubleshooting

Every OpenRouter failure is reported with the message OpenRouter itself returned, so the
status code is never the whole story. The text reaches the UI through the stream, either on
the failing agent's row or in the node body.

| Symptom | Cause |
| --- | --- |
| `429: Rate limit exceeded: free-models-per-day` | The account's daily free-model quota is gone. It resets at 00:00 UTC; adding 10 credits to the OpenRouter account raises the cap from 50 to 1000 requests per day. Every benchmark run costs one request per configured model. |
| `400: <id> is not a valid model ID` | The model id in `frontend/src/agents.ts` no longer exists. Check `https://openrouter.ai/api/v1/models`. |
| `402` | Out of credits for a paid model. |
| A block contains only the winning answer | The benchmark succeeded, but local Ollama parsing failed. Open the raw response to see `semantic_error`. |
| `Benchmark request failed (502)` | The Rust service on `:8001` is not running, or FastAPI cannot reach it. |
| The whole run fails immediately | Usually the daily quota above, because all models share it. Verify with `curl -s -X POST http://127.0.0.1:8001/run -H 'Content-Type: application/json' -d '{"model":"nex-agi/nex-n2.5-pro:free","prompt":"Say OK"}'`. |

Free models are also slow and unevenly so: a single run can take anywhere from two seconds
to over two minutes per model. Local Ollama parsing starts only after every model has finished,
because picking the winner needs all the scores.

## Security note

`fastfusion/benchmark_serializer/.env` (which holds the OpenRouter key) is currently **tracked by git**: `fastfusion/.gitignore` lists it with a `./` prefix, which gitignore does not support, so the pattern never matches. The same applies to the committed `fastfusion/benchmark_serializer/target/` build directory. Recommended fix:

1. Rotate the OpenRouter key (treat the committed one as leaked).
2. Change the patterns in `fastfusion/.gitignore` to `benchmark_serializer/.env` and `benchmark_serializer/target/`.
3. Untrack the files: `git rm --cached fastfusion/benchmark_serializer/.env` and `git rm -r --cached fastfusion/benchmark_serializer/target`, then commit.

## Repository layout

```text
.
├── README.md
└── fastfusion/
    ├── backend/                    # FastAPI proxy: main.py, schemas.py, rust_client.py, requirements.txt
    ├── benchmark_serializer/       # Rust/Axum benchmark service: src/, Cargo.toml, .env (see Security note)
    ├── extrafiles/
    └── benchmark.json
```
