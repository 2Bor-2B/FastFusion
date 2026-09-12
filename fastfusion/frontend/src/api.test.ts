import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TEMPLATE, SUMMARY_MODEL } from './agents';
import { describeScore, pickWinner, runLiveAgents } from './api';
import type { RunRecord, ScoreBreakdown } from './api';
import type { AgentRun, RunHandlers, Stage } from './types';

const MODELS = AGENT_TEMPLATE.map((agent) => agent.model);

function score(total: number, over: Partial<ScoreBreakdown> = {}): ScoreBreakdown {
  return {
    total,
    correctness_score: 0,
    visibility_score: 30,
    richness_score: 10,
    latency_score: 15,
    reasoning_visible: true,
    reasoning_chars: 1875,
    has_plaintext_reasoning: true,
    has_summary_reasoning: false,
    has_encrypted_reasoning: false,
    ...over,
  };
}

function resultLine(model: string, total: number, latencyMs: number, answer = 'An answer.') {
  return JSON.stringify({
    type: 'result',
    record: {
      model,
      case_id: 'trace-1',
      category: 'user',
      prompt: 'Question?',
      answer,
      reasoning: 'Because.',
      reasoning_details: [],
      usage: {},
      latency_ms: latencyMs,
      correct: null,
      score: score(total),
    } satisfies RunRecord,
  });
}

const errorLine = (model: string, error: string) =>
  JSON.stringify({ type: 'error', model, case_id: 'trace-1', error });

const summaryLine = (model: string, total: number, latencyMs: number) => JSON.stringify({
  type: 'summary',
  winner: { model, case_id: 'trace-1', score_total: total, latency_ms: latencyMs },
  summary_model: SUMMARY_MODEL,
  title: 'A clear path',
  summary: 'Do the small thing first.',
  insights: ['Ship it', 'Measure it'],
  next_step: 'Try one experiment.',
  parsed: true,
  raw: { model: SUMMARY_MODEL, answer: '{}', reasoning: null, reasoning_details: [], usage: {}, latency_ms: 900 },
});

const summaryErrorLine = (model: string, error: string) => JSON.stringify({
  type: 'summary_error',
  winner: { model, case_id: 'trace-1', score_total: 50, latency_ms: 100 },
  summary_model: SUMMARY_MODEL,
  error,
});

const doneLine = JSON.stringify({ type: 'done', total_runs: 3 });

/** Streams the given raw chunks verbatim, so tests control the split points. */
function streamOf(chunks: string[], ok = true, status = 200, bodyText = '') {
  const encoder = new TextEncoder();
  const body = ok
    ? new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    })
    : null;
  return {
    ok,
    status,
    body,
    text: async () => bodyText,
  } as unknown as Response;
}

function collector() {
  const agentStates: AgentRun[][] = [];
  const stages: Stage[] = [];
  const winners: string[] = [];
  const handlers: RunHandlers = {
    onAgents: (agents) => agentStates.push(agents),
    onStage: (stage) => stages.push(stage),
    onWinner: (winnerId) => winners.push(winnerId),
  };
  return { agentStates, stages, winners, handlers, last: () => agentStates[agentStates.length - 1] };
}

function stub(chunks: string[], ok = true, status = 200, bodyText = '') {
  const fetchMock = vi.fn(async () => streamOf(chunks, ok, status, bodyText));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('runLiveAgents', () => {
  it('applies results that arrive out of order, across chunk boundaries', async () => {
    // The middle result is split across two chunks; the last chunk carries two lines.
    const second = `${resultLine(MODELS[0], 88, 1500)}\n`;
    const chunks = [
      `${resultLine(MODELS[2], 31, 120000)}\n${second.slice(0, 40)}`,
      `${second.slice(40)}${resultLine(MODELS[1], 42, 60000)}\n`,
      `${summaryLine(MODELS[0], 88, 1500)}\n${doneLine}\n`,
    ];
    stub(chunks);

    const { handlers, stages, winners, last } = collector();
    const analysis = await runLiveAgents('Question?', handlers, { caseId: 'trace-1' });

    const agents = last();
    expect(agents.map((a) => a.status)).toEqual(['complete', 'complete', 'complete']);
    expect(agents.map((a) => a.score)).toEqual([88, 42, 31]);
    expect(agents[0].duration).toBe('1.5s');
    expect(agents[2].duration).toBe('120.0s');
    expect(agents[0].preview).toBe('An answer.');

    expect(winners).toEqual(['nex-mini']);
    expect(stages).toEqual(['thinking', 'scoring', 'summarizing', 'complete']);
    expect(analysis.winnerId).toBe('nex-mini');
    expect(analysis.winnerScore).toBe(88);
    expect(analysis.synthesis).toEqual({
      title: 'A clear path',
      summary: 'Do the small thing first.',
      insights: ['Ship it', 'Measure it'],
      nextStep: 'Try one experiment.',
    });
    expect((analysis.raw as { results: RunRecord[] }).results).toHaveLength(3);
  });

  it('sends the models, a single null-expectation case and the summary model', async () => {
    const fetchMock = stub([`${resultLine(MODELS[0], 50, 1000)}\n${doneLine}\n`]);
    const { handlers } = collector();
    await runLiveAgents('Question?', handlers, { caseId: 'trace-9' });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.models).toEqual(MODELS);
    expect(body.cases).toHaveLength(1);
    expect(body.cases[0]).toEqual({
      id: 'trace-9', category: 'user', prompt: 'Question?', expected_contains: null,
    });
    expect(body.summary_model).toBe(SUMMARY_MODEL);
  });

  it('announces the winner exactly once, before the summary lands', async () => {
    const events: string[] = [];
    stub([
      `${resultLine(MODELS[0], 70, 1000)}\n`,
      `${resultLine(MODELS[1], 60, 2000)}\n`,
      `${resultLine(MODELS[2], 50, 3000)}\n`,
      `${summaryLine(MODELS[0], 70, 1000)}\n${doneLine}\n`,
    ]);
    const handlers: RunHandlers = {
      onAgents: () => events.push('agents'),
      onStage: (stage) => events.push(`stage:${stage}`),
      onWinner: (id) => events.push(`winner:${id}`),
    };
    await runLiveAgents('Question?', handlers, { caseId: 'trace-1' });

    expect(events.filter((e) => e.startsWith('winner:'))).toEqual(['winner:nex-mini']);
    expect(events.indexOf('winner:nex-mini')).toBeLessThan(events.indexOf('stage:complete'));
  });

  it('marks a failing model and still picks a winner from the rest', async () => {
    stub([
      `${resultLine(MODELS[0], 40, 1000)}\n`,
      `${errorLine(MODELS[1], 'OpenRouter returned 429: slow down')}\n`,
      `${resultLine(MODELS[2], 55, 9000)}\n${summaryLine(MODELS[2], 55, 9000)}\n${doneLine}\n`,
    ]);
    const { handlers, last } = collector();
    const analysis = await runLiveAgents('Question?', handlers, { caseId: 'trace-1' });

    const agents = last();
    expect(agents[1].status).toBe('failed');
    expect(agents[1].error).toContain('429');
    expect(agents[1].score).toBeUndefined();
    expect(analysis.winnerId).toBe('nemotron');
    expect((analysis.raw as { errors: unknown[] }).errors).toHaveLength(1);
  });

  it('surfaces a summary_error as readable text without failing the run', async () => {
    stub([
      `${resultLine(MODELS[0], 44, 1000)}\n`,
      `${resultLine(MODELS[1], 20, 2000)}\n${resultLine(MODELS[2], 10, 3000)}\n`,
      `${summaryErrorLine(MODELS[0], 'daily quota exhausted')}\n${doneLine}\n`,
    ]);
    const { handlers } = collector();
    const analysis = await runLiveAgents('Question?', handlers, { caseId: 'trace-1' });

    expect(analysis.winnerId).toBe('nex-mini');
    expect(analysis.synthesis.summary).toBe('Summary unavailable: daily quota exhausted');
    expect(analysis.synthesis.insights).toEqual([]);
    expect(analysis.synthesis.title).toBe('');
  });

  it('falls back when the stream carries no summary at all', async () => {
    stub([`${resultLine(MODELS[0], 44, 1000)}\n${doneLine}\n`]);
    const { handlers } = collector();
    const analysis = await runLiveAgents('Question?', handlers, { caseId: 'trace-1' });
    expect(analysis.synthesis.summary).toMatch(/^Summary unavailable: the backend did not return a summary/);
  });

  it('resolves when the stream ends without a done line', async () => {
    // No trailing newline either: the final partial line must still be flushed.
    stub([`${resultLine(MODELS[0], 44, 1000)}\n${summaryLine(MODELS[0], 44, 1000)}`]);
    const { handlers } = collector();
    const analysis = await runLiveAgents('Question?', handlers, { caseId: 'trace-1' });
    expect(analysis.winnerId).toBe('nex-mini');
    expect(analysis.synthesis.title).toBe('A clear path');
  });

  it('rejects on a non-2xx response and includes the body', async () => {
    stub([], false, 502, 'rust service unreachable');
    const { handlers } = collector();
    await expect(runLiveAgents('Question?', handlers, { caseId: 'trace-1' }))
      .rejects.toThrow('Benchmark request failed (502): rust service unreachable');
  });

  it('rejects when every model fails', async () => {
    stub([
      `${errorLine(MODELS[0], 'OpenRouter returned 429: out of quota')}\n`,
      `${errorLine(MODELS[1], 'boom')}\n${errorLine(MODELS[2], 'boom')}\n${doneLine}\n`,
    ]);
    const { handlers } = collector();
    await expect(runLiveAgents('Question?', handlers, { caseId: 'trace-1' }))
      .rejects.toThrow('All agents failed: OpenRouter returned 429: out of quota');
  });

  it('skips malformed lines instead of failing the run', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stub([`not json at all\n${resultLine(MODELS[0], 44, 1000)}\n${doneLine}\n`]);
    const { handlers } = collector();
    const analysis = await runLiveAgents('Question?', handlers, { caseId: 'trace-1' });
    expect(analysis.winnerId).toBe('nex-mini');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('pickWinner', () => {
  const agent = (id: string): AgentRun => ({
    id, name: id, model: id, role: '', color: '', status: 'complete',
  });

  it('prefers the highest score, then the lower latency, then template order', () => {
    const records = new Map<string, RunRecord>();
    const put = (id: string, total: number, latency: number) => records.set(id, {
      model: id,
      case_id: 'c',
      category: 'user',
      prompt: 'p',
      answer: null,
      reasoning: null,
      reasoning_details: null,
      usage: null,
      latency_ms: latency,
      correct: null,
      score: score(total),
    });
    put('a', 50, 900);
    put('b', 50, 400);
    put('c', 70, 9000);
    expect(pickWinner([agent('a'), agent('b'), agent('c')], records)).toBe('c');

    records.delete('c');
    expect(pickWinner([agent('a'), agent('b')], records)).toBe('b');

    put('b', 50, 900);
    expect(pickWinner([agent('a'), agent('b')], records)).toBe('a');
  });

  it('ignores agents that did not complete', () => {
    const waiting: AgentRun = { ...agent('a'), status: 'failed' };
    expect(pickWinner([waiting], new Map())).toBeUndefined();
  });
});

describe('describeScore', () => {
  it('reads the breakdown in plain language', () => {
    expect(describeScore(score(60))).toBe('Reasoning shown in full · 1,875 chars · speed 15/20');
    expect(describeScore(score(20, {
      has_plaintext_reasoning: false, has_summary_reasoning: true, reasoning_chars: 12, latency_score: 8,
    }))).toBe('Reasoning summarised only · 12 chars · speed 8/20');
    expect(describeScore(score(0, {
      has_plaintext_reasoning: false, reasoning_chars: 0, latency_score: 0,
    }))).toBe('No visible reasoning · 0 chars · speed 0/20');
  });
});
