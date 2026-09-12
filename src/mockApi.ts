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
    summary: `针对“${prompt}”，多个 Agent 的答案在目标拆解上基本一致。最佳路径优先建立可验证的最小闭环，再根据实时反馈逐步扩展。`,
    insights: [
      '先确认目标、约束和成功标准，避免过早优化。',
      '将复杂任务拆分为可独立验证的阶段，并保留失败回退。',
      '优先使用可观察的数据决定下一步，而不是依赖单次生成。',
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
