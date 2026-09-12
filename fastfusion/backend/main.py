import json

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from schemas import (
    RunRequest,
    BenchmarkRequest,
    ReasoningParseRequest,
    ParsedReasoning,
    SkillGenerateRequest,
    AgentSkill,
)

from rust_client import (
    run_model,
    benchmark_stream,
)

from ollama_client import (
    OllamaProcessingError,
    OllamaUnavailableError,
    generate_skill,
    parse_reasoning,
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


@app.post("/api/reasoning/parse", response_model=ParsedReasoning)
async def reasoning_parse(request: ReasoningParseRequest):
    try:
        return await parse_reasoning(request)
    except OllamaUnavailableError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except OllamaProcessingError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/api/skills/generate", response_model=AgentSkill)
async def skill_generate(request: SkillGenerateRequest):
    try:
        return await generate_skill(request)
    except OllamaUnavailableError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except OllamaProcessingError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
