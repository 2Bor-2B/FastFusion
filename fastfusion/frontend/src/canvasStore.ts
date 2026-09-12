import type { ThoughtNode } from './types';

export type CanvasView = { x: number; y: number; scale: number };

export type CanvasSnapshot = {
  version: 1;
  savedAt: string;
  /** Shown in the top bar and used as the save filename. */
  name: string;
  nodes: ThoughtNode[];
  view: CanvasView;
  selectedId: string | null;
};

export const DEFAULT_CANVAS_NAME = 'Untitled canvas';

/** Trims, collapses whitespace and caps the length; empty falls back to the default. */
export function normaliseName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, 60);
  return name || DEFAULT_CANVAS_NAME;
}

/** Turns a picked filename into a canvas name (drops the .json extension). */
export function nameFromFile(fileName: string): string {
  return normaliseName(fileName.replace(/\.json$/i, ''));
}

/** Turns a canvas name into a safe download filename. */
export function fileNameFor(name: string): string {
  const base = name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  return `${base || DEFAULT_CANVAS_NAME}.json`;
}

const STORAGE_KEY = 'fastfusion.canvas.v1';

/** jsdom and locked-down browsers may not expose Web Storage at all. */
function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}
const BUSY_STAGES = new Set(['thinking', 'scoring', 'summarizing']);

/**
 * A run cannot survive a reload, so any node caught mid-flight comes back as
 * cancelled (and therefore retryable) rather than stuck on a spinner.
 */
function settle(node: ThoughtNode): ThoughtNode {
  if (!BUSY_STAGES.has(node.stage)) return node;
  return {
    ...node,
    stage: 'cancelled',
    agents: node.agents.map((agent) => (agent.status === 'running' || agent.status === 'waiting'
      ? { ...agent, status: 'failed' as const }
      : agent)),
  };
}

/** Accepts only the shape we wrote; anything else is treated as absent. */
export function parseSnapshot(raw: unknown): CanvasSnapshot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Partial<CanvasSnapshot>;
  if (value.version !== 1 || !Array.isArray(value.nodes)) return null;

  const nodes = value.nodes.filter(
    (node): node is ThoughtNode => !!node
      && typeof node.id === 'string'
      && typeof node.prompt === 'string'
      && typeof node.x === 'number'
      && typeof node.y === 'number'
      && Array.isArray(node.agents),
  ).map(settle);

  const view = value.view;
  const safeView: CanvasView = view
    && Number.isFinite(view.x) && Number.isFinite(view.y) && Number.isFinite(view.scale)
    ? { x: view.x, y: view.y, scale: Math.min(1.6, Math.max(0.2, view.scale)) }
    : { x: 0, y: 0, scale: 1 };

  const ids = new Set(nodes.map((node) => node.id));
  return {
    version: 1,
    savedAt: typeof value.savedAt === 'string' ? value.savedAt : '',
    name: typeof value.name === 'string' ? normaliseName(value.name) : DEFAULT_CANVAS_NAME,
    nodes: nodes.map((node) => (node.parentId && ids.has(node.parentId)
      ? node
      : { ...node, parentId: null })),
    view: safeView,
    selectedId: typeof value.selectedId === 'string' && ids.has(value.selectedId)
      ? value.selectedId
      : null,
  };
}

export function buildSnapshot(
  nodes: ThoughtNode[],
  view: CanvasView,
  selectedId: string | null,
  savedAt: string,
  name: string = DEFAULT_CANVAS_NAME,
): CanvasSnapshot {
  return { version: 1, savedAt, name: normaliseName(name), nodes, view, selectedId };
}

/** Reads the autosaved canvas. Returns null when storage is empty or blocked. */
export function loadCanvas(): CanvasSnapshot | null {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    return raw ? parseSnapshot(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Autosaves the canvas. Silently does nothing where storage is unavailable. */
export function saveCanvas(snapshot: CanvasSnapshot): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* Private window, blocked site data, or quota exceeded. */
  }
}

export function clearCanvas(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* Nothing to do. */
  }
}
