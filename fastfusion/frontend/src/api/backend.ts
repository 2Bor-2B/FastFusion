export interface RunRequest {
  model: string
  prompt: string
  reasoning_effort?: string
}

export interface BenchmarkCase {
  id: string
  category: string
  prompt: string
  expected_contains?: string | null
}

export interface BenchmarkRequest {
  models: string[]
  cases: BenchmarkCase[]
  reasoning_effort?: string
}

export interface RunResult {
  model: string
  answer: string | null
  reasoning: string | null
  reasoning_details: unknown
  usage: unknown
  latency_ms: number
  [key: string]: unknown
}

export interface BenchmarkRecord extends RunResult {
  case_id: string
  category: string
  correct: boolean | null
  score: {
    total: number
    [key: string]: unknown
  }
}

export type BenchmarkEvent =
  | { type: "result"; record: BenchmarkRecord }
  | { type: "error"; model: string; case_id: string; error: string }
  | { type: "done"; total_runs: number }

export type SnippetKind =
  | "observation"
  | "hypothesis"
  | "decision"
  | "comparison"
  | "rejection"
  | "action"
  | "validation"
  | "conclusion"
  | "other"

export interface ReasoningSnippet {
  id: string
  title: string
  summary: string
  kind: SnippetKind
  source_indices: number[]
  important: boolean
}

export interface ParsedReasoning {
  summary: string
  snippets: ReasoningSnippet[]
}

export interface AgentSkill {
  name: string
  description: string
  when_to_use: string[]
  procedure: string[]
  checks: string[]
  avoid: string[]
  source_snippet_ids: string[]
  example?: string | null
}

async function errorMessage(response: Response): Promise<string> {
  const detail = await response.text()
  return detail || response.statusText || "Unknown backend error"
}

export async function checkHealth(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch("/health", { signal })
    return response.ok
  } catch {
    return false
  }
}

export async function runModel(
  request: RunRequest,
  signal?: AbortSignal,
): Promise<RunResult> {
  const response = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  })

  if (!response.ok) {
    throw new Error(`Model request failed (${response.status}): ${await errorMessage(response)}`)
  }

  return response.json() as Promise<RunResult>
}

export async function runBenchmark(
  request: BenchmarkRequest,
  onEvent: (event: BenchmarkEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/benchmark", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    },
    body: JSON.stringify(request),
    signal,
  })

  if (!response.ok) {
    throw new Error(`Benchmark failed (${response.status}): ${await errorMessage(response)}`)
  }
  if (!response.body) throw new Error("This browser does not expose the response stream")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        break
      }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        if (line.trim()) onEvent(JSON.parse(line) as BenchmarkEvent)
      }
    }
    if (buffer.trim()) onEvent(JSON.parse(buffer) as BenchmarkEvent)
  } finally {
    reader.releaseLock()
  }
}

export async function parseReasoning(
  record: BenchmarkRecord,
  signal?: AbortSignal,
): Promise<ParsedReasoning> {
  const response = await fetch("/api/reasoning/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: record.model,
      case_id: record.case_id,
      reasoning: record.reasoning,
      reasoning_details: record.reasoning_details,
    }),
    signal,
  })

  if (!response.ok) {
    throw new Error(`Reasoning parse failed (${response.status}): ${await errorMessage(response)}`)
  }
  return response.json() as Promise<ParsedReasoning>
}

export async function generateSkill(
  record: BenchmarkRecord,
  selectedSnippets: ReasoningSnippet[],
  signal?: AbortSignal,
): Promise<AgentSkill> {
  const response = await fetch("/api/skills/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name_hint: null,
      source: { model: record.model, case_id: record.case_id },
      selected_snippets: selectedSnippets,
    }),
    signal,
  })

  if (!response.ok) {
    throw new Error(`Skill generation failed (${response.status}): ${await errorMessage(response)}`)
  }
  return response.json() as Promise<AgentSkill>
}
