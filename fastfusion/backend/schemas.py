from pydantic import BaseModel


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
