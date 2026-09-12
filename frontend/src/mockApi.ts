export type AgentStatus = 'queued' | 'running' | 'complete' | 'failed';

export type AgentRun = {
  id: string;
  name: string;
  model: string;
  color: string;
  status: AgentStatus;
  score?: number;
  duration?: string;
};

export type MockAnalysis = {
  winnerId: string;
  summary: string;
  insights: string[];
  raw: Record<string, unknown>;
};

export const AGENT_TEMPLATE: AgentRun[] = [
  { id: 'atlas', name: 'Atlas', model: 'GPT-5', color: '#7aa2ff', status: 'queued' },
  { id: 'nova', name: 'Nova', model: 'Claude 4', color: '#c29cff', status: 'queued' },
  { id: 'orion', name: 'Orion', model: 'Gemini 2.5', color: '#5ed8c6', status: 'queued' },
  { id: 'local', name: 'Local-7B', model: 'Fine-tuned', color: '#f0b66e', status: 'queued' },
];

const SCORES = [92, 86, 89, 78];
const DURATIONS = ['2.4s', '2.1s', '2.8s', '1.3s'];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runMockAgents(
  prompt: string,
  onUpdate: (agents: AgentRun[]) => void,
  onSummarizing: (winnerId: string) => void,
): Promise<MockAnalysis> {
  let agents = AGENT_TEMPLATE.map((agent) => ({ ...agent }));
  onUpdate(agents);

  for (let index = 0; index < agents.length; index += 1) {
    await wait(180);
    agents = agents.map((agent, current) => current === index ? { ...agent, status: 'running' } : agent);
    onUpdate(agents);
    await wait(360);
    agents = agents.map((agent, current) => current === index
      ? { ...agent, status: 'complete', score: SCORES[index], duration: DURATIONS[index] }
      : agent);
    onUpdate(agents);
  }

  const winnerId = 'atlas';
  onSummarizing(winnerId);
  await wait(620);

  return {
    winnerId,
    summary: `For “${prompt},” the agents broadly agree on how to break down the objective. The strongest approach starts with the smallest verifiable loop, then expands from live feedback.`,
    insights: [
      'Confirm the objective, constraints, and success criteria before optimizing.',
      'Split complex work into independently verifiable stages with a fallback path.',
      'Use observable evidence to choose the next step instead of relying on one generation.',
    ],
    raw: {
      request_id: `req_${Date.now().toString(36)}`,
      prompt,
      selected_agent: 'atlas',
      score: 0.92,
      latency_ms: 2418,
      response: {
        strategy: 'constraint-first decomposition',
        steps: ['define objective', 'rank constraints', 'build smallest loop', 'measure and iterate'],
        confidence: 0.88,
      },
      benchmark: Object.fromEntries(agents.map(({ id, score, duration }) => [id, { score, duration }])),
    },
  };
}
