import json

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from schemas import (
    RunRequest,
    BenchmarkRequest,
)

from rust_client import (
    run_model,
    benchmark_stream,
)

app = FastAPI(
    title="Metacog Backend"
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {
        "status": "ok"
    }


@app.post("/api/run")
async def run(request: RunRequest):
    return await run_model(
        request.model_dump()
    )


@app.post("/api/benchmark")
async def benchmark(
    request: BenchmarkRequest
):
    async def stream():
        async for event in benchmark_stream(
            request.model_dump()
        ):
            yield json.dumps(event) + "\n"

    return StreamingResponse(
        stream(),
        media_type="application/x-ndjson",
    )
