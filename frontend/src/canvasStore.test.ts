import { afterEach, describe, expect, it } from 'vitest';
import { buildSnapshot, clearCanvas, loadCanvas, parseSnapshot, saveCanvas } from './canvasStore';
import type { ThoughtNode } from './types';

function node(over: Partial<ThoughtNode> = {}): ThoughtNode {
  return {
    id: 'a',
    parentId: null,
    x: 0,
    y: 0,
    prompt: 'Question?',
    stage: 'complete',
    agents: [],
    expanded: false,
    picked: false,
    ...over,
  };
}

const view = { x: 12, y: 34, scale: 0.8 };

afterEach(() => clearCanvas());

describe('parseSnapshot', () => {
  it('rejects anything that is not a version 1 canvas', () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot('nope')).toBeNull();
    expect(parseSnapshot({})).toBeNull();
    expect(parseSnapshot({ version: 2, nodes: [] })).toBeNull();
    expect(parseSnapshot({ version: 1 })).toBeNull();
  });

  it('settles nodes that were mid-run when the page went away', () => {
    const snapshot = parseSnapshot(buildSnapshot(
      [node({
        stage: 'summarizing',
        agents: [
          { id: 'x', name: 'X', model: 'x', role: '', color: '', status: 'running' },
          { id: 'y', name: 'Y', model: 'y', role: '', color: '', status: 'complete', score: 10 },
        ],
      })],
      view, 'a', '2026-01-01T00:00:00.000Z',
    ));
    expect(snapshot!.nodes[0].stage).toBe('cancelled');
    expect(snapshot!.nodes[0].agents.map((a) => a.status)).toEqual(['failed', 'complete']);
  });

  it('drops malformed nodes and parent links that point nowhere', () => {
    const snapshot = parseSnapshot({
      version: 1,
      nodes: [node({ id: 'a' }), { id: 'broken' }, node({ id: 'b', parentId: 'ghost' })],
      view,
      selectedId: 'gone',
    });
    expect(snapshot!.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(snapshot!.nodes[1].parentId).toBeNull();
    expect(snapshot!.selectedId).toBeNull();
  });

  it('clamps an out-of-range zoom and replaces a broken view', () => {
    expect(parseSnapshot({ version: 1, nodes: [], view: { x: 0, y: 0, scale: 99 } })!.view.scale).toBe(1.6);
    expect(parseSnapshot({ version: 1, nodes: [], view: { x: 0, y: 0, scale: 0 } })!.view.scale).toBe(0.2);
    expect(parseSnapshot({ version: 1, nodes: [], view: 'bad' })!.view).toEqual({ x: 0, y: 0, scale: 1 });
  });
});

describe('saveCanvas / loadCanvas', () => {
  it('round-trips a canvas through storage', () => {
    saveCanvas(buildSnapshot([node({ id: 'a' })], view, 'a', '2026-01-01T00:00:00.000Z'));
    const restored = loadCanvas();
    expect(restored!.nodes).toHaveLength(1);
    expect(restored!.view).toEqual(view);
    expect(restored!.selectedId).toBe('a');
  });

  it('returns null when nothing was stored, and after clearing', () => {
    expect(loadCanvas()).toBeNull();
    saveCanvas(buildSnapshot([node()], view, null, ''));
    expect(loadCanvas()).not.toBeNull();
    clearCanvas();
    expect(loadCanvas()).toBeNull();
  });

  it('survives corrupt stored JSON', () => {
    localStorage.setItem('fastfusion.canvas.v1', '{not json');
    expect(loadCanvas()).toBeNull();
  });
});
