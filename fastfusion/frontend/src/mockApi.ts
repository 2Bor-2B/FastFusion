import { freshAgents } from './agents';
import type { AgentRun, Analysis, RunHandlers, RunOptions } from './types';

const SCORES = [92, 86, 89];
const DURATIONS = ['2.4s', '2.1s', '2.8s'];
const PREVIEWS = [
  'Treat reliability as an engineering property of the system, not of the model: assume it will be wrong and design the recovery path first.',
  'Separate the parts that reason from the parts that enforce rules, then make every external action reviewable.',
  'Start from the failure modes. Enumerate them, then decide which need a human and which can be retried automatically.',
];
const REASONS = [
  'Reasoning shown in full · 2,064 chars · speed 20/20',
  'Reasoning shown in full · 1,796 chars · speed 15/20',
  'Reasoning summarised only · 246 chars · speed 8/20',
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * In-browser stand-in for the benchmark backend. Same protocol as
 * `runLiveAgents`, so the interface cannot tell the two apart. The trailing
 * options argument is accepted for signature compatibility and ignored.
 */
export async function runMockAgents(
  prompt: string,
  handlers: RunHandlers,
  _options?: RunOptions,
): Promise<Analysis> {
  let agents: AgentRun[] = freshAgents().map((agent) => ({ ...agent, status: 'running' as const }));
  handlers.onAgents(agents);
  handlers.onStage('thinking');

  for (let index = 0; index < agents.length; index += 1) {
    await wait(180);
    await wait(360);
    agents = agents.map((agent, current) => (current === index
      ? {
        ...agent,
        status: 'complete' as const,
        score: SCORES[index % SCORES.length],
        duration: DURATIONS[index % DURATIONS.length],
        preview: PREVIEWS[index % PREVIEWS.length],
        reason: REASONS[index % REASONS.length],
      }
      : agent));
    handlers.onAgents(agents.map((agent) => ({ ...agent })));
  }

  const winnerId = agents[0].id;
  handlers.onStage('scoring');
  handlers.onWinner(winnerId);
  handlers.onStage('summarizing');
  await wait(620);
  handlers.onStage('complete');

  return {
    winnerId,
    winnerScore: SCORES[0],
    synthesis: {
      title: '让系统替模型兜底',
      summary: `针对“${prompt}”，多个 Agent 的答案在目标拆解上基本一致。最佳路径优先建立可验证的最小闭环，再根据实时反馈逐步扩展。`,
      insights: [
        '先确认目标、约束和成功标准，避免过早优化。',
        '将复杂任务拆分为可独立验证的阶段，并保留失败回退。',
        '优先使用可观察的数据决定下一步，而不是依赖单次生成。',
      ],
      nextStep: '接着可以追问具体的失败回退策略，或某一阶段的验收标准。',
    },
    raw: {
      request_id: `req_${Date.now().toString(36)}`,
      prompt,
      selected_agent: winnerId,
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
