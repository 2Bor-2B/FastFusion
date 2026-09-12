# Benchmark serializer

After setting `OPENROUTER_API_KEY`, start the service with `cargo run`. Replace the placeholder model IDs in `benchmark.json`, then stream a benchmark with:

```bash
curl -N \
  -X POST \
  http://localhost:8001/benchmark/stream \
  -H "Content-Type: application/json" \
  -d @benchmark.json
```

The response uses `application/x-ndjson`. It emits one `result` or `error` line whenever each model/case run completes, followed by one `done` line.
