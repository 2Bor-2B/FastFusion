export type AgentStatus = 'waiting' | 'running' | 'complete' | 'failed';

/** Lifecycle of one node, mirrored in the activity panel's headline. */
export type Stage =
  | 'thinking'
  | 'scoring'
  | 'summarizing'
  | 'complete'
  | 'error'
  | 'cancelled';

export type AgentRun = {
  id: string;
  name: string;
  /** OpenRouter model id this agent maps to. */
  model: string;
  role: string;
  color: string;
  status: AgentStatus;
  /** 0-100, rounded from the Rust score. */
  score?: number;
  duration?: string;
  /** Opening of the model's answer, shown while the panel is open. */
  preview?: string;
  /** Plain-language read of the score breakdown. */
  reason?: string;
  error?: string;
};

/** What the summary model produced for the winning answer. */
export type Synthesis = {
  title: string;
  summary: string;
  insights: string[];
  nextStep: string;
};

export type Analysis = {
  winnerId: string;
  /** Winner's score on a 0-100 integer scale. */
  winnerScore: number;
  synthesis: Synthesis;
  raw: Record<string, unknown>;
};

export type ThoughtNode = {
  id: string;
  parentId: string | null;
  x: number;
  y: number;
  prompt: string;
  stage: Stage;
  agents: AgentRun[];
  winnerId?: string;
  synthesis?: Synthesis;
  raw?: Record<string, unknown>;
  score?: number;
  error?: string;
  /** Original prompt + raw JSON drawer. */
  expanded: boolean;
  /** Ticked for the Markdown skills export. */
  picked: boolean;
};

export type RunHandlers = {
  onAgents: (agents: AgentRun[]) => void;
  onStage: (stage: Stage) => void;
  onWinner: (winnerId: string) => void;
};

export type RunOptions = { caseId?: string; signal?: AbortSignal };
