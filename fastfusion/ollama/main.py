import json
import logging

import httpx
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field, ValidationError


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("reasoning-analyzer")


OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_MODEL = "llama3.1:8b"


app = FastAPI(
    title="AI Reasoning Chunk & Summary Backend",
    description=(
        "Analyzes AI reasoning traces into structured logical chunks "
        "and an overall summary using Ollama."
    ),
    version="1.0.0",
)


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------

class ChunkItem(BaseModel):
    title: str = Field(
        ...,
        description=(
            "Concise descriptive title of what the model "
            "is doing at this stage."
        ),
    )

    content: str = Field(
        ...,
        description=(
            "Explanation of the reasoning process performed "
            "during this stage."
        ),
    )


class AnalyzeRequest(BaseModel):
    reasoning: str = Field(
        ...,
        min_length=1,
        description="A reasoning process produced by another AI.",
        json_schema_extra={
            "example": (
                "First, we should determine the constraints. "
                "The array is sorted. Next, a binary search offers "
                "O(log n) time. Finally, we implement binary search "
                "to find the target."
            )
        },
    )


class AnalyzeResponse(BaseModel):
    chunks: list[ChunkItem] = Field(
        ...,
        description=(
            "Logical chunks of the reasoning process "
            "in sequential order."
        ),
    )

    summary: str = Field(
        ...,
        description=(
            "Concise overall summary of the reasoning strategy."
        ),
    )


# Use the same Pydantic schema for Ollama structured output.
ANALYSIS_JSON_SCHEMA = AnalyzeResponse.model_json_schema()


SYSTEM_PROMPT = """
You are an AI reasoning process analyzer.

Your task is to transform reasoning produced by another AI into a clear,
concise breakdown of its reasoning process.

Instructions:

1. Break the reasoning into a small number of meaningful logical stages.
2. Do NOT split the text merely by sentences or paragraphs.
3. Merge repetitive, semantically similar, or logically connected steps.
4. Preserve the chronological and logical order of the original reasoning.
5. Each chunk should represent one meaningful reasoning operation or stage.
6. Give each chunk:
   - a short descriptive title
   - a concise explanation of what the AI was doing during that stage
7. Focus on the reasoning PROCESS rather than simply rewriting the text.
8. Do not introduce information, assumptions, or conclusions that are not
   present in the original reasoning.
9. Produce a concise overall summary explaining the strategy used throughout
   the reasoning process.

Return only valid JSON matching the provided schema.
""".strip()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
async def root():
    return {
        "status": "ok",
        "service": "reasoning-analyzer",
        "model": OLLAMA_MODEL,
    }


@app.post(
    "/analyze",
    response_model=AnalyzeResponse,
    status_code=status.HTTP_200_OK,
    summary="Analyze AI reasoning into structured chunks and summary",
)
async def analyze_reasoning(request: AnalyzeRequest) -> AnalyzeResponse:
    payload = {
        "model": OLLAMA_MODEL,
        "messages": [
            {
                "role": "system",
                "content": SYSTEM_PROMPT,
            },
            {
                "role": "user",
                "content": (
                    "Reasoning text to analyze:\n\n"
                    f"{request.reasoning}"
                ),
            },
        ],
        "format": ANALYSIS_JSON_SCHEMA,
        "stream": False,
        "options": {
            "temperature": 0,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json=payload,
            )

    except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
        logger.error(
            "Failed to connect to Ollama at %s: %s",
            OLLAMA_BASE_URL,
            exc,
        )

        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                f"Unable to connect to Ollama at {OLLAMA_BASE_URL}. "
                "Ensure Ollama is running."
            ),
        ) from exc

    except httpx.RequestError as exc:
        logger.error(
            "HTTP request error while calling Ollama: %s",
            exc,
        )

        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Network error communicating with Ollama: {exc}",
        ) from exc


    if response.status_code != 200:
        logger.error(
            "Ollama returned status code %d: %s",
            response.status_code,
            response.text,
        )

        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                f"Ollama API returned status "
                f"{response.status_code}: {response.text}"
            ),
        )


    try:
        ollama_data = response.json()

    except json.JSONDecodeError as exc:
        logger.error(
            "Ollama HTTP response was not valid JSON: %s",
            exc,
        )

        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Ollama returned an invalid HTTP JSON response.",
        ) from exc


    message_content = (
        ollama_data
        .get("message", {})
        .get("content", "")
    )

    if not message_content:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Ollama returned empty message content.",
        )


    try:
        parsed_result = json.loads(message_content)

    except json.JSONDecodeError as exc:
        logger.error(
            "Failed to parse structured output from Ollama: %s",
            exc,
        )

        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Ollama model returned invalid structured JSON."
            ),
        ) from exc


    try:
        validated_response = AnalyzeResponse.model_validate(
            parsed_result
        )

    except ValidationError as exc:
        logger.error(
            "Ollama output failed schema validation: %s",
            exc,
        )

        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Ollama output did not match the required schema."
            ),
        ) from exc


    return validated_response