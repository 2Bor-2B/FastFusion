import { AGENT_TEMPLATE, REASONING_EFFORT, SUMMARY_MODEL, findAgentByModel, freshAgents } from './agents';
import { runMockAgents } from './mockApi';
import type { AgentRun, Analysis, RunHandlers, RunOptions, Synthesis } from './types';

/** `VITE_USE_MOCK=true` swaps the live backend for the in-browser mock. */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

/** Backend origin. Empty means same origin (the Vite dev server proxies `/api`). */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '';

// ---------------------------------------------------------------------------
// Backend contract: POST /api/benchmark (FastAPI) -> Rust /benchmark/stream.
// The response is NDJSON: one JSON object per line, in the order
//   result | error (any order, as runs finish)
//   -> summary | summary_error (at most one)
//   -> done.
// ---------------------------------------------------------------------------

export type BenchmarkCase = {
  id: string;
  category: string;
  prompt: string;
  expected_contains: string | null;
};

export type BenchmarkRequest = {
  models: string[];
  cases: BenchmarkCase[];
  reasoning_effort: string;
  summary_model?: string | null;
};

export type ScoreBreakdown = {
  total: number;
  correctness_score: number;
  visibility_score: number;
  richness_score: number;
  latency_score: number;
  reasoning_visible: boolean;
  reasoning_chars: number;
  has_plaintext_reasoning: boolean;
  has_summary_reasoning: boolean;
  has_encrypted_reasoning: boolean;
};

export type RunRecord = {
  model: string;
  case_id: string;
  category: string;
  prompt: string;
  answer: string | null;
  reasoning: string | null;
  reasoning_details: unknown;
  usage: unknown;
  latency_ms: number;
  correct: boolean | null;
  score: ScoreBreakdown;
};

export type WinnerRef = {
  model: string;
  case_id: string;
  score_total: number;
  latency_ms: number;
};

export type SummaryRaw = {
  model: string;
  answer: string | null;
  reasoning: string | null;
  reasoning_details: unknown;
  usage: unknown;
  latency_ms: number;
};

export type ResultLine = { type: 'result'; record: RunRecord };
export type ErrorLine = { type: 'error'; model: string; case_id: string; error: string };
export type SummaryLine = {
  type: 'summary';
  winner: WinnerRef;
  summary_model: string;
  title?: string;
  summary: string;
  insights: string[];
  next_step?: string;
  parsed: boolean;
  raw: SummaryRaw;
};
export type SummaryErrorLine = {
  type: 'summary_error';
  winner: WinnerRef;
  summary_model: string;
  error: string;
};
export type DoneLine = { type: 'done'; total_runs: number };
export type StreamLine = ResultLine | ErrorLine | SummaryLine | SummaryErrorLine | DoneLine;

/** Shape of `Analysis.raw` produced by `runLiveAgents`. */
export type LiveRawPayload = {
  request: BenchmarkRequest;
  winner: RunRecord | null;
  results: RunRecord[];
  errors: ErrorLine[];
  summary: SummaryLine | SummaryErrorLine | null;
};

const NO_SUMMARY_TEXT = 'Summary unavailable: the backend did not return a summary.';
const PREVIEW_CHARS = 150;

function formatDuration(latencyMs: number): string {
  return `${(latencyMs / 1000).toFixed(1)}s`;
}

function preview(answer: string | null): string {
  const text = (answer ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return 'The model returned an empty answer.';
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
}

/** Turns the Rust score breakdown into one readable line. */
export function describeScore(score: ScoreBreakdown): string {
  const parts: string[] = [];
  if (score.has_plaintext_reasoning) parts.push('Reasoning shown in full');
  else if (score.has_summary_reasoning) parts.push('Reasoning summarised only');
  else if (score.has_encrypted_reasoning) parts.push('Reasoning encrypted');
  else parts.push('No visible reasoning');
  parts.push(`${score.reasoning_chars.toLocaleString()} chars`);
  parts.push(`speed ${Math.round(score.latency_score)}/20`);
  return parts.join(' · ');
}

/**
 * Winner rule shared with the Rust service: highest score, then lower latency,
 * then template order (agents are iterated in order and only a strictly better
 * candidate replaces the current best).
 */
export function pickWinner(agents: AgentRun[], records: Map<string, RunRecord>): string | undefined {
  let best: { id: string; total: number; latency: number } | undefined;
  for (const agent of agents) {
    if (agent.status !== 'complete') continue;
    const record = records.get(agent.id);
    const total = record?.score.total ?? agent.score ?? 0;
    const latency = record?.latency_ms ?? Number.POSITIVE_INFINITY;
    if (!best || total > best.total || (total === best.total && latency < best.latency)) {
      best = { id: agent.id, total, latency };
    }
  }
  return best?.id;
}

export async function runLiveAgents(
  prompt: string,
  handlers: RunHandlers,
  options?: RunOptions,
): Promise<Analysis> {
  // Every model runs concurrently on the backend, so they all start together.
  let agents: AgentRun[] = freshAgents().map((agent) => ({ ...agent, status: 'running' as const }));
  handlers.onAgents(agents);
  handlers.onStage('thinking');

  const request: BenchmarkRequest = {
    models: AGENT_TEMPLATE.map((agent) => agent.model),
    cases: [
      {
        id: options?.caseId ?? `trace-${Date.now()}`,
        category: 'user',
        prompt,
        expected_contains: null,
      },
    ],
    reasoning_effort: REASONING_EFFORT,
    summary_model: SUMMARY_MODEL,
  };

  const response = await fetch(`${API_BASE}/api/benchmark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify(request),
    signal: options?.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Benchmark request failed (${response.status})${text ? `: ${text}` : ''}`);
  }
  if (!response.body) {
    throw new Error('Benchmark request returned no response body');
  }

  // Mutable stream state lives on one object so the closures below and the tail
  // of this function observe the same (un-narrowed) values.
  const state = {
    results: [] as RunRecord[],
    errors: [] as ErrorLine[],
    records: new Map<string, RunRecord>(),
    summary: null as SummaryLine | SummaryErrorLine | null,
    summaryWinnerId: undefined as string | undefined,
    announcedWinnerId: undefined as string | undefined,
    done: false,
  };

  const publish = (next: AgentRun[]) => {
    agents = next.map((agent) => ({ ...agent }));
    handlers.onAgents(agents);
  };

  const patchAgent = (id: string, patch: Partial<AgentRun>) => {
    publish(agents.map((agent) => (agent.id === id ? { ...agent, ...patch } : agent)));
  };

  /** Once every model has reported, rank them and start the synthesis. */
  const maybeStartSummarizing = () => {
    if (state.announcedWinnerId) return;
    const allTerminal = agents.every((a) => a.status === 'complete' || a.status === 'failed');
    if (!allTerminal) return;
    const winnerId = pickWinner(agents, state.records);
    if (!winnerId) return;
    state.announcedWinnerId = winnerId;
    handlers.onStage('scoring');
    handlers.onWinner(winnerId);
    handlers.onStage('summarizing');
  };

  /** Applies one NDJSON line. Returns true once the `done` line has been seen. */
  const handleLine = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed) return false;

    let event: StreamLine;
    try {
      event = JSON.parse(trimmed) as StreamLine;
    } catch (error) {
      console.warn('[benchmark] skipping malformed NDJSON line', trimmed, error);
      return false;
    }

    switch (event.type) {
      case 'result': {
        const agent = findAgentByModel(agents, event.record.model);
        if (!agent) {
          console.warn('[benchmark] result for unknown model ignored', event.record.model);
          return false;
        }
        state.results.push(event.record);
        state.records.set(agent.id, event.record);
        patchAgent(agent.id, {
          status: 'complete',
          score: Math.round(event.record.score.total),
          duration: formatDuration(event.record.latency_ms),
          preview: preview(event.record.answer),
          reason: describeScore(event.record.score),
        });
        maybeStartSummarizing();
        return false;
      }
      case 'error': {
        state.errors.push(event);
        const agent = findAgentByModel(agents, event.model);
        if (!agent) {
          console.warn('[benchmark] error for unknown model ignored', event.model, event.error);
          return false;
        }
        patchAgent(agent.id, { status: 'failed', error: event.error, preview: event.error });
        maybeStartSummarizing();
        return false;
      }
      case 'summary':
      case 'summary_error': {
        state.summary = event;
        state.summaryWinnerId = findAgentByModel(agents, event.winner.model)?.id;
        return false;
      }
      case 'done':
        return true;
      default:
        console.warn('[benchmark] unknown stream event ignored', event);
        return false;
    }
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (!state.done) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (handleLine(line)) {
          state.done = true;
          break;
        }
        newline = buffer.indexOf('\n');
      }
    }
    if (!state.done) {
      // The stream ended without a `done` line: flush any trailing partial line.
      buffer += decoder.decode();
      if (buffer.trim()) handleLine(buffer);
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }

  if (!agents.some((agent) => agent.status === 'complete')) {
    throw new Error(`All agents failed: ${state.errors[0]?.error ?? 'no results'}`);
  }

  // Anything the stream never reported on can no longer finish.
  if (agents.some((agent) => agent.status === 'running')) {
    publish(agents.map((a) => (a.status === 'running' ? { ...a, status: 'failed' as const } : a)));
  }
  maybeStartSummarizing();

  const localWinnerId = state.announcedWinnerId ?? pickWinner(agents, state.records);
  const winnerId = state.summaryWinnerId && state.records.has(state.summaryWinnerId)
    ? state.summaryWinnerId
    : localWinnerId;
  if (!winnerId) {
    throw new Error('All agents failed: no results');
  }
  const winnerAgent = agents.find((agent) => agent.id === winnerId);

  const event = state.summary;
  const synthesis: Synthesis = event === null
    ? { title: '', summary: NO_SUMMARY_TEXT, insights: [], nextStep: '' }
    : event.type === 'summary'
      ? {
        title: (event.title ?? '').trim(),
        summary: event.summary,
        insights: event.insights ?? [],
        nextStep: (event.next_step ?? '').trim(),
      }
      : { title: '', summary: `Summary unavailable: ${event.error}`, insights: [], nextStep: '' };

  const raw: LiveRawPayload = {
    request,
    winner: state.records.get(winnerId) ?? null,
    results: state.results,
    errors: state.errors,
    summary: event,
  };

  handlers.onStage('complete');

  return {
    winnerId,
    winnerScore: winnerAgent?.score ?? 0,
    synthesis,
    raw,
  };
}

/** The runner the app uses: the mock when `VITE_USE_MOCK=true`, else the backend. */
export const runAgents: typeof runLiveAgents = USE_MOCK ? runMockAgents : runLiveAgents;
