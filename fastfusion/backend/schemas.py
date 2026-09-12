from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class RunRequest(BaseModel):
    model: str
    prompt: str
    reasoning_effort: str = "high"


class BenchmarkCase(BaseModel):
    id: str
    category: str
    prompt: str
    expected_contains: str | None = None


class BenchmarkRequest(BaseModel):
    models: list[str]
    cases: list[BenchmarkCase]
    reasoning_effort: str = "high"


SnippetKind = Literal[
    "observation",
    "hypothesis",
    "decision",
    "comparison",
    "rejection",
    "action",
    "validation",
    "conclusion",
    "other",
]


class ReasoningSnippet(BaseModel):
    id: str
    title: str
    summary: str
    kind: SnippetKind
    source_indices: list[int] = Field(min_length=1)
    important: bool = False


class ParsedReasoning(BaseModel):
    summary: str
    snippets: list[ReasoningSnippet]


class ReasoningParseRequest(BaseModel):
    model: str
    case_id: str
    reasoning: str | None = None
    reasoning_details: Any = None

    @model_validator(mode="after")
    def require_reasoning_telemetry(self):
        if not self.reasoning and not self.reasoning_details:
            raise ValueError("reasoning or reasoning_details must contain telemetry")
        return self


class SkillSource(BaseModel):
    model: str
    case_id: str


class SkillGenerateRequest(BaseModel):
    name_hint: str | None = None
    source: SkillSource
    selected_snippets: list[ReasoningSnippet] = Field(min_length=1)

    @model_validator(mode="after")
    def require_unique_snippet_ids(self):
        snippet_ids = [snippet.id for snippet in self.selected_snippets]
        if len(snippet_ids) != len(set(snippet_ids)):
            raise ValueError("selected snippet IDs must be unique")
        return self


class AgentSkill(BaseModel):
    name: str
    description: str
    when_to_use: list[str]
    procedure: list[str]
    checks: list[str]
    avoid: list[str]
    source_snippet_ids: list[str] = Field(min_length=1)
    example: str | None = None
