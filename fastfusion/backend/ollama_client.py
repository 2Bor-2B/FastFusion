import json
import os
from typing import Any

import httpx
from ollama import AsyncClient, ResponseError
from pydantic import ValidationError

from schemas import (
    AgentSkill,
    ParsedReasoning,
    ReasoningParseRequest,
    SkillGenerateRequest,
)


OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma4:latest")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "180"))


PARSER_SYSTEM_PROMPT = """You are a reasoning-trace interpreter.

You receive reasoning telemetry explicitly exposed by an AI provider.
Convert it into concise human-readable reasoning snippets.

Rules:
- Write every output field in English, regardless of the input language.
- Do not invent missing reasoning or unsupported conclusions.
- Treat the input as provider-exposed telemetry, not hidden chain-of-thought.
- Preserve the original logical order.
- Group only closely related adjacent steps.
- Every snippet must contain one or more indices from valid_source_indices.
- The server assigns snippet IDs; any generated ID is treated as provisional.
- Summaries describe what the model did; they do not imitate private thoughts.
- Prefer short, engineering-oriented descriptions.
- Return only data matching the provided JSON schema.
"""


SKILL_SYSTEM_PROMPT = """You are an AI-agent skill synthesizer.

You receive reasoning snippets explicitly selected by an engineer because they
represent useful behavior. Convert that behavior into a reusable general skill.

Rules:
- Write every output field in English, regardless of the input language.
- Generalize beyond the specific benchmark example.
- Do not reproduce the trace verbatim or invent unsupported capabilities.
- Preserve the useful strategy and make it actionable for another AI agent.
- Keep the skill compact.
- Separate triggers, procedure, validation checks, and failure modes.
- source_snippet_ids must include every selected snippet ID exactly once.
- Return only data matching the provided JSON schema.
"""


class OllamaUnavailableError(RuntimeError):
    pass


class OllamaProcessingError(RuntimeError):
    pass


def _message_content(response: Any) -> str:
    message = getattr(response, "message", None)
    content = getattr(message, "content", None)
    if not isinstance(content, str) or not content.strip():
        raise OllamaProcessingError("Ollama returned an empty response")
    return content


def _source_indices(payload: ReasoningParseRequest) -> list[int]:
    details = payload.reasoning_details
    indices: list[int] = []
    if isinstance(details, list):
        for position, item in enumerate(details):
            index = item.get("index") if isinstance(item, dict) else None
            indices.append(index if isinstance(index, int) else position)
    elif details:
        indices.append(0)
    elif payload.reasoning:
        indices.append(0)
    return list(dict.fromkeys(indices))


async def _structured_chat(system: str, payload: dict, schema: type):
    client = AsyncClient(host=OLLAMA_HOST, timeout=OLLAMA_TIMEOUT)
    try:
        response = await client.chat(
            model=OLLAMA_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
            format=schema.model_json_schema(),
            options={"temperature": 0},
        )
    except (ConnectionError, httpx.ConnectError, httpx.ConnectTimeout) as error:
        raise OllamaUnavailableError("Local Ollama service is unavailable") from error
    except ResponseError as error:
        if error.status_code in {404, 503}:
            raise OllamaUnavailableError(
                f"Ollama model '{OLLAMA_MODEL}' is unavailable"
            ) from error
        raise OllamaProcessingError(f"Ollama request failed: {error.error}") from error
    except httpx.HTTPError as error:
        raise OllamaUnavailableError("Local Ollama service is unavailable") from error

    try:
        return schema.model_validate_json(_message_content(response))
    except ValidationError as error:
        raise OllamaProcessingError(
            "Ollama returned invalid structured output"
        ) from error


async def parse_reasoning(payload: ReasoningParseRequest) -> ParsedReasoning:
    valid_indices = _source_indices(payload)
    prompt_payload = payload.model_dump()
    prompt_payload["valid_source_indices"] = valid_indices
    parsed = await _structured_chat(
        PARSER_SYSTEM_PROMPT,
        prompt_payload,
        ParsedReasoning,
    )

    previous_index = -1
    valid_set = set(valid_indices)
    for position, snippet in enumerate(parsed.snippets):
        if not set(snippet.source_indices).issubset(valid_set):
            raise OllamaProcessingError("Ollama returned invalid source indices")
        first_index = min(snippet.source_indices)
        if first_index < previous_index:
            raise OllamaProcessingError("Ollama reordered the reasoning sources")
        snippet.id = f"snippet-{position}"
        previous_index = first_index
    return parsed


async def generate_skill(payload: SkillGenerateRequest) -> AgentSkill:
    skill = await _structured_chat(
        SKILL_SYSTEM_PROMPT,
        payload.model_dump(),
        AgentSkill,
    )
    selected_ids = [snippet.id for snippet in payload.selected_snippets]
    if len(skill.source_snippet_ids) != len(set(skill.source_snippet_ids)):
        raise OllamaProcessingError("Ollama returned duplicate source snippet IDs")
    if set(skill.source_snippet_ids) != set(selected_ids):
        raise OllamaProcessingError("Ollama did not preserve selected snippet IDs")
    return skill
