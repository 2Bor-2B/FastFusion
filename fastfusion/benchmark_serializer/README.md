# Benchmark serializer

After setting `OPENROUTER_API_KEY`, start the service with `cargo run`. Replace the placeholder model IDs in `benchmark.json`, then stream a benchmark with:

```bash
curl -N \
  -X POST \
  http://localhost:8001/benchmark/stream \
  -H "Content-Type: application/json" \
  -d @benchmark.json
```

## Request

```json
{
  "models": ["nex-agi/nex-n2.5-mini:free", "nex-agi/nex-n2.5-pro:free", "nvidia/nemotron-3-ultra-550b-a55b:free"],
  "cases": [{"id": "trace-1757600000000", "category": "user", "prompt": "<user question>", "expected_contains": null}],
  "reasoning_effort": "high",
  "summary_model": "nex-agi/nex-n2.5-pro:free"
}
```

- `reasoning_effort` is optional and defaults to `"high"`.
- `expected_contains` may be `null`: free-form questions have no reference answer, so the record's `correct` is `null` and `correctness_score` is `0`.
- `summary_model` is optional. When present (and non-empty), once every (model × case) run has finished the service picks the winning run and asks this model, through the same OpenRouter client and key, to synthesize it. When absent or `null`, no `summary` / `summary_error` line is emitted.

## Response

The response uses `application/x-ndjson`: one JSON object per line, each terminated by `\n`. Order:

1. zero or more `result` / `error` lines, one as each (model, case) run finishes (arbitrary order; runs execute concurrently);
2. at most one `summary` or `summary_error` line (only when `summary_model` is set and at least one `result` exists);
3. exactly one `done` line.

### Winner rule

Among `result` records: the highest `score.total`; tie → the lower `latency_ms`; tie → the run that finished first. If there are no `result` records at all, no summary is attempted and only `done` follows.

### Summary parsing

The summary model is asked for a JSON object `{"title": string, "summary": string, "insights": string[], "next_step": string}`. `title` and `next_step` are optional and default to `""`. If its answer cannot be parsed (a code fence or leading prose around the JSON is tolerated), `summary` is set to the raw answer text, the other fields are emptied, and `parsed` is `false`. A parse failure is never reported as an error; `summary_error` is only emitted when the summarizer request itself fails.

### Event types

`result` — one finished run:

```json
{"type":"result","record":{"model":"<model id>","case_id":"trace-…","category":"user","prompt":"<case prompt>","answer":"<string|null>","reasoning":"<string|null>","reasoning_details":<json>,"usage":<json>,"latency_ms":1234,"correct":null,"score":{"total":57.5,"correctness_score":0,"visibility_score":30,"richness_score":12.5,"latency_score":15,"reasoning_visible":true,"reasoning_chars":1875,"has_plaintext_reasoning":true,"has_summary_reasoning":false,"has_encrypted_reasoning":false}}}
```

`error` — one run that failed:

```json
{"type":"error","model":"<model id>","case_id":"trace-…","error":"<message>"}
```

`summary` — the synthesized winner (`raw` is the summarizer's own run result):

```json
{"type":"summary","winner":{"model":"<model id>","case_id":"trace-…","score_total":57.5,"latency_ms":1234},"summary_model":"nex-agi/nex-n2.5-pro:free","title":"<headline, 6 words or fewer>","summary":"<2-4 sentences>","insights":["<principle>","<principle>","<principle>"],"next_step":"<one sentence>","parsed":true,"raw":{"model":"nex-agi/nex-n2.5-pro:free","answer":"<summarizer raw answer>","reasoning":"<string|null>","reasoning_details":<json>,"usage":<json>,"latency_ms":900}}
```

`summary_error` — the summarizer request failed:

```json
{"type":"summary_error","winner":{"model":"<model id>","case_id":"trace-…","score_total":57.5,"latency_ms":1234},"summary_model":"nex-agi/nex-n2.5-pro:free","error":"<message>"}
```

`done` — always the last line; `total_runs` is `models.length × cases.length`:

```json
{"type":"done","total_runs":3}
```
