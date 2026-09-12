I have an existing Rust Axum service that already:

- exposes `POST /run`
- calls the OpenRouter API through `reqwest`
- requests reasoning with `reasoning_effort`
- returns a `RunResult` containing:
  - `model`
  - `answer`
  - `reasoning`
  - `reasoning_details`
  - `usage`
  - `latency_ms`
- already has these modules:

```text
src/
├── main.rs
├── config.rs
├── error.rs
├── state.rs
├── api/
│   ├── mod.rs
│   ├── handlers.rs
│   └── routes.rs
├── openrouter/
│   ├── mod.rs
│   ├── client.rs
│   ├── types.rs
│   └── models.rs
└── benchmark/
    ├── mod.rs
    ├── runner.rs
    └── scoring.rs
```

Do not rewrite the OpenRouter client unless necessary. Extend the existing codebase to implement an interactive parallel benchmark system.

## Goal

I want to benchmark multiple OpenRouter reasoning models against multiple reasoning-heavy test cases in parallel.

The system must:

1. accept multiple models
2. accept multiple benchmark cases
3. execute all `(model, case)` combinations concurrently
4. emit each result immediately when it finishes rather than waiting for all runs
5. preserve OpenRouter reasoning output exactly
6. compute benchmark scores separately from the raw reasoning data
7. stream results as NDJSON
8. make the resulting JSON easy for a later FastAPI backend to consume and store

Do not add FastAPI code. Only implement the Rust side.

---

## 1. Add benchmark types

Create:

```text
src/benchmark/types.rs
```

Add:

```rust
BenchmarkCase
```

with:

```rust
pub id: String
pub category: String
pub prompt: String
pub expected_contains: Option<String>
```

Add:

```rust
BenchmarkRequest
```

with:

```rust
pub models: Vec<String>
pub cases: Vec<BenchmarkCase>
pub reasoning_effort: String
```

Default `reasoning_effort` to `"high"` if omitted.

Add:

```rust
BenchmarkRecord
```

containing:

```rust
pub model: String
pub case_id: String
pub category: String

pub answer: Option<String>

pub reasoning: Option<String>
pub reasoning_details: serde_json::Value

pub usage: serde_json::Value

pub latency_ms: u128

pub correct: Option<bool>

pub score: BenchmarkScore
```

The original `reasoning` and `reasoning_details` fields must be forwarded without modification.

Add a streaming event enum:

```rust
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BenchmarkEvent
```

with variants:

```rust
Result {
    record: BenchmarkRecord
}

Error {
    model: String,
    case_id: String,
    error: String
}

Done {
    total_runs: usize
}
```

Update:

```text
src/benchmark/mod.rs
```

to export:

```rust
pub mod runner;
pub mod scoring;
pub mod types;
```

---

## 2. Improve benchmark scoring

Update:

```text
src/benchmark/scoring.rs
```

Create:

```rust
BenchmarkScore
```

with these serialized fields:

```rust
pub total: f64

pub correctness_score: f64
pub visibility_score: f64
pub richness_score: f64
pub latency_score: f64

pub reasoning_visible: bool
pub reasoning_chars: usize

pub has_plaintext_reasoning: bool
pub has_summary_reasoning: bool
pub has_encrypted_reasoning: bool
```

Implement:

```rust
pub fn score(
    run: &RunResult,
    correct: Option<bool>,
) -> BenchmarkScore
```

Initial scoring policy:

```text
correctness:
true  = 30
false = 0
None  = 0

reasoning visibility:
plaintext reasoning = 30
summary only         = 15
encrypted only       = 0
none                 = 0

reasoning richness:
up to 20 points
linear from 0 to 3000 visible reasoning characters

latency:
< 2000 ms   = 20
< 5000 ms   = 15
< 10000 ms  = 8
otherwise   = 0
```

`total` is the sum.

Reasoning detection must inspect both:

```rust
run.reasoning
```

and:

```rust
run.reasoning_details
```

Detect at least these `reasoning_details` types:

```text
reasoning.text
reasoning.summary
reasoning.encrypted
```

Do not alter the original `reasoning_details`.

---

## 3. Benchmark runner

Update:

```text
src/benchmark/runner.rs
```

Implement:

```rust
pub async fn execute_case(
    state: &AppState,
    model: String,
    case: BenchmarkCase,
    reasoning_effort: String,
) -> Result<BenchmarkRecord, String>
```

It must:

1. call the existing:

```rust
openrouter::run(...)
```

2. pass the benchmark case prompt
3. pass the selected model
4. pass the benchmark request's reasoning effort
5. calculate correctness
6. calculate scoring
7. return a `BenchmarkRecord`

Correctness can initially be simple case-insensitive substring matching:

```rust
answer contains expected_contains
```

Return `None` when there is no expected answer.

Do not use another LLM as a judge.

---

## 4. Interactive parallel benchmark

Add a new Axum endpoint:

```text
POST /benchmark/stream
```

The handler should accept:

```rust
Json<BenchmarkRequest>
```

and return:

```text
Content-Type: application/x-ndjson
```

Use:

```rust
futures::stream::FuturesUnordered
```

rather than `join_all`.

Every `(model, case)` pair should run concurrently.

Important behavior:

If:

```text
model A takes 12 seconds
model B takes 3 seconds
model C takes 6 seconds
```

the stream must emit:

```text
B result
C result
A result
```

as soon as each completes.

Do not wait for all models before emitting results.

Use an async channel such as:

```rust
tokio::sync::mpsc
```

and return an Axum streaming `Body`.

Each NDJSON line should contain one serialized `BenchmarkEvent`.

Example:

```json
{"type":"result","record":{...}}
```

or:

```json
{"type":"error","model":"...","case_id":"...","error":"..."}
```

After every run finishes, emit:

```json
{"type":"done","total_runs":10}
```

followed by newline.

Do not silently discard model errors.

---

## 5. Routes

Add:

```rust
.route(
    "/benchmark/stream",
    post(handlers::benchmark_stream),
)
```

Keep the existing `/run` and `/health` routes working.

If an older `/benchmark` endpoint exists, do not break it unless necessary.

---

## 6. Dependencies

Use existing dependencies where possible.

If required, add:

```toml
futures = "0.3"
tokio-stream = "0.1"
```

Do not introduce large frameworks or unnecessary abstractions.

---

## 7. Benchmark material

Create an example file in the repository:

```text
benchmark.json
```

containing three placeholder model IDs:

```json
"models": [
  "MODEL_A",
  "MODEL_B",
  "MODEL_C"
]
```

and the following benchmark cases.

### Ordering

```text
Alice is older than Bob. Bob is older than Charlie. Charlie is older than Diana. Return only: FINAL: <name of oldest person>
```

Expected:

```text
Alice
```

### Scheduling

```text
There are two workers. Task P takes 2 hours. Task Q takes 1 hour and can only begin after P finishes. Task R takes 3 hours and is independent. All tasks must complete. What is the minimum completion time? Return only: FINAL: <number> hours
```

Expected:

```text
3
```

### Shortest path

```text
A weighted graph has edges A-B=2, A-C=5, B-C=1, B-D=4, C-D=1. Find the shortest distance from A to D. Return only: FINAL: <distance>
```

Expected:

```text
4
```

### API selection

```text
You need all records matching a filter from a dataset of 50,000 records. Exactly 400 records match. Each response contains at most 100 records. API A costs 1 unit per request but cannot paginate and therefore can return at most the first 100 records. API B costs 3 units per request, supports server-side filtering and pagination. API C costs 2 units per request, supports pagination but no server-side filtering, so all 50,000 records must be retrieved before filtering locally. Which API retrieves all matching records at minimum total request cost? Return only: FINAL: <A, B, or C>
```

Expected:

```text
B
```

### Wrong box labels

```text
There are three boxes labeled APPLES, ORANGES, and APPLES+ORANGES. Every label is wrong. You may draw one fruit from one box to determine all three correct labels. Which labeled box must you draw from? Return only: FINAL: <box label>
```

Expected:

```text
APPLES+ORANGES
```

Do not ask models to output chain-of-thought in their final response. The normal response should remain short. Reasoning must come from OpenRouter's reasoning fields.

---

## 8. FastAPI-compatible output

Design every `BenchmarkRecord` so it can later be consumed by a Python service simply by reading NDJSON lines and calling:

```python
json.loads(line)
```

A successful record should conceptually resemble:

```json
{
  "type": "result",
  "record": {
    "model": "some-model",
    "case_id": "api-choice-01",
    "category": "decision",

    "answer": "FINAL: B",

    "reasoning": "...",

    "reasoning_details": [
      {
        "type": "reasoning.text",
        "text": "...",
        "index": 0
      }
    ],

    "usage": {},

    "latency_ms": 3482,

    "correct": true,

    "score": {
      "total": 88.7,
      "correctness_score": 30.0,
      "visibility_score": 30.0,
      "richness_score": 13.7,
      "latency_score": 15.0,

      "reasoning_visible": true,
      "reasoning_chars": 2055,

      "has_plaintext_reasoning": true,
      "has_summary_reasoning": false,
      "has_encrypted_reasoning": false
    }
  }
}
```

Preserving raw reasoning JSON is more important than aggressively typing every OpenRouter reasoning subtype.

---

## 9. Validation

After implementing the changes:

1. run:

```bash
cargo fmt
```

2. run:

```bash
cargo check
```

3. fix all compile errors

4. ensure existing `/health` and `/run` endpoints still work

5. document how to test the streaming benchmark using:

```bash
curl -N \
  -X POST \
  http://localhost:8001/benchmark/stream \
  -H "Content-Type: application/json" \
  -d @benchmark.json
```

The output must visibly arrive one NDJSON object at a time as models complete.

Do not redesign unrelated parts of the repository. Prefer minimal changes that integrate cleanly with the existing code.