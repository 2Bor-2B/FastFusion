import type { AgentRun } from './types';

/** The OpenRouter models benchmarked on every run, in display order. */
export const AGENT_TEMPLATE: AgentRun[] = [
  {
    id: 'nex-mini',
    name: 'Nex Mini',
    model: 'nex-agi/nex-n2.5-mini:free',
    role: 'Fast reasoning',
    color: '#9dc2f5',
    status: 'waiting',
  },
  {
    id: 'nex-pro',
    name: 'Nex Pro',
    model: 'nex-agi/nex-n2.5-pro:free',
    role: 'Deeper reasoning',
    color: '#c2d9f7',
    status: 'waiting',
  },
  {
    id: 'nemotron',
    name: 'Nemotron Ultra',
    model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    role: 'Large-scale review',
    color: '#b8cfef',
    status: 'waiting',
  },
];

/** Model asked to compress the winning answer into a synthesis. */
export const SUMMARY_MODEL = 'nex-agi/nex-n2.5-pro:free';

export const REASONING_EFFORT = 'high';

/** Fresh copies, so a new run never mutates the template. */
export function freshAgents(): AgentRun[] {
  return AGENT_TEMPLATE.map((agent) => ({ ...agent }));
}

export function findAgentByModel(agents: AgentRun[], model: string): AgentRun | undefined {
  return agents.find((agent) => agent.model === model);
}
