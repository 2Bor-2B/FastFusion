import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import { AGENT_TEMPLATE, freshAgents } from './agents';
import { USE_MOCK, runAgents } from './api';
import {
  DEFAULT_CANVAS_NAME, buildSnapshot, clearCanvas, fileNameFor, loadCanvas, nameFromFile,
  normaliseName, parseSnapshot, saveCanvas,
} from './canvasStore';
import type { CanvasView } from './canvasStore';
import type { AgentRun, Stage, ThoughtNode } from './types';
import {
  ArrowUp, ArrowUpRight, Check, ChevronDown, ChevronRight, Copy, Download, Expand, FolderOpen,
  GitBranch, Grip, LoaderCircle, Minus, Plus, RotateCcw, Save, Square, Terminal, Trophy, X,
} from './icons';

const WIDTH = 430;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1.6;

const stageLabels: Record<Stage, string> = {
  thinking: 'Exploring in parallel',
  scoring: 'Evaluating responses',
  summarizing: 'Synthesizing the best response',
  complete: 'Exploration complete',
  error: 'Something went wrong',
  cancelled: 'Exploration stopped',
};

const busyStages: Stage[] = ['thinking', 'scoring', 'summarizing'];

type View = CanvasView;
type Gesture = { kind: 'pan' | 'node'; id?: string; x: number; y: number; originX: number; originY: number };

export default function App() {
  // The canvas is restored from localStorage before the first paint, so a
  // refresh lands on the same nodes at the same position.
  const [restored] = useState(loadCanvas);
  const [nodes, setNodes] = useState<ThoughtNode[]>(() => restored?.nodes ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(() => restored?.selectedId ?? null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [view, setView] = useState<View>(() => restored?.view ?? { x: 0, y: 0, scale: 1 });
  const [panelOpen, setPanelOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  /** True while a programmatic camera move is playing, so it eases instead of cutting. */
  const [gliding, setGliding] = useState(false);
  const [canvasName, setCanvasName] = useState(() => restored?.name ?? DEFAULT_CANVAS_NAME);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const viewRef = useRef(view); viewRef.current = view;
  const nodesRef = useRef(nodes); nodesRef.current = nodes;
  const selectedRef = useRef(selectedId); selectedRef.current = selectedId;
  const activeRef = useRef<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const glideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef(canvasName); nameRef.current = canvasName;

  const current = nodes.find((node) => node.id === selectedId);
  const activity = nodes.find((node) => node.id === (activeId || selectedId));
  const busy = !!activeId;
  const started = nodes.length > 0;
  const pickedCount = nodes.filter((node) => node.picked && node.synthesis).length;

  const updateNode = useCallback(
    (id: string, patch: Partial<ThoughtNode> | ((node: ThoughtNode) => Partial<ThoughtNode>)) =>
      setNodes((list) => list.map((node) => (node.id === id
        ? { ...node, ...(typeof patch === 'function' ? patch(node) : patch) }
        : node))),
    [],
  );

  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  }, []);

  /** Eases the next camera change instead of snapping to it. */
  const glide = useCallback(() => {
    setGliding(true);
    clearTimeout(glideTimer.current);
    glideTimer.current = setTimeout(() => setGliding(false), 480);
  }, []);

  /** Any direct manipulation must track the pointer exactly, so cancel the ease. */
  const cutGlide = useCallback(() => {
    clearTimeout(glideTimer.current);
    setGliding(false);
  }, []);

  const centerNode = useCallback((node: ThoughtNode, scale = 1) => {
    const width = window.innerWidth;
    const element = document.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`);
    const height = element ? element.getBoundingClientRect().height / viewRef.current.scale : 350;
    // Measure the command bar, not the whole dock: the activity panel animates
    // its height, so the dock is still mid-transition on the frame after it closes.
    const command = document.querySelector<HTMLElement>('.command');
    const floor = command?.getBoundingClientRect().top || window.innerHeight - 110;
    const available = Math.max(160, floor - 148);
    const fitted = Math.max(0.25, Math.min(scale, (width - 40) / WIDTH, available / height));
    glide();
    setView({
      x: width / 2 - (WIDTH * fitted) / 2 - node.x * fitted,
      y: 120 + (available - height * fitted) / 2 - node.y * fitted,
      scale: fitted,
    });
  }, [glide]);

  const run = useCallback(async (id: string, question: string, retry = false) => {
    if (activeRef.current) return;
    clearTimeout(closeTimer.current);
    activeRef.current = id;
    setActiveId(id);
    setPanelOpen(true);

    const controller = new AbortController();
    abortRef.current = controller;

    if (retry) {
      updateNode(id, {
        stage: 'thinking',
        agents: freshAgents(),
        error: undefined,
        winnerId: undefined,
        synthesis: undefined,
        raw: undefined,
        score: undefined,
      });
    }

    const handlers = {
      onAgents: (agents: AgentRun[]) => {
        if (!controller.signal.aborted) updateNode(id, { agents });
      },
      onStage: (stage: Stage) => {
        if (!controller.signal.aborted) updateNode(id, { stage });
      },
      onWinner: (winnerId: string) => {
        if (!controller.signal.aborted) updateNode(id, { winnerId });
      },
    };

    try {
      const result = await runAgents(question, handlers, { caseId: id, signal: controller.signal });
      if (controller.signal.aborted) return;
      updateNode(id, {
        stage: 'complete',
        winnerId: result.winnerId,
        synthesis: result.synthesis,
        raw: result.raw,
        score: result.winnerScore,
      });
      closeTimer.current = setTimeout(() => setPanelOpen(false), 1500);
    } catch (error) {
      if (controller.signal.aborted) {
        updateNode(id, (node) => ({
          stage: 'cancelled',
          agents: node.agents.map((agent) => (agent.status === 'running'
            ? { ...agent, status: 'failed' as const }
            : agent)),
        }));
      } else {
        const message = error instanceof Error ? error.message : String(error);
        updateNode(id, (node) => ({
          stage: 'error',
          error: message,
          agents: node.agents.map((agent) => (agent.status === 'complete'
            ? agent
            : { ...agent, status: 'failed' as const })),
        }));
        setPanelOpen(false);
      }
    } finally {
      if (activeRef.current === id) {
        activeRef.current = null;
        setActiveId(null);
        abortRef.current = null;
      }
    }
  }, [updateNode]);

  const submit = useCallback(async (question: string) => {
    const clean = question.trim();
    if (!clean || clean.length > 2000 || activeRef.current) return;

    // A new node branches from the selected completed node, or starts a root.
    const parent = nodesRef.current.find(
      (node) => node.id === selectedRef.current && node.stage === 'complete',
    ) || null;
    const siblings = nodesRef.current.filter((node) => node.parentId === (parent?.id || null));
    const x = parent ? parent.x + WIDTH + 120 : 0;
    let y = parent ? parent.y : 0;
    if (siblings.length) y += siblings.length * 700;
    while (nodesRef.current.some((node) => Math.abs(node.x - x) < WIDTH + 40 && Math.abs(node.y - y) < 680)) {
      y += 700;
    }

    const id = `trace-${Date.now().toString(36)}-${nodesRef.current.length + 1}`;
    const node: ThoughtNode = {
      id,
      parentId: parent?.id || null,
      x,
      y,
      prompt: clean,
      stage: 'thinking',
      agents: freshAgents(),
      expanded: false,
      picked: false,
    };
    setNodes((list) => [...list, node]);
    setSelectedId(id);
    setPrompt('');
    centerNode(node, Math.min(1, (window.innerWidth - 40) / WIDTH));
    await run(id, clean);
  }, [centerNode, run]);

  const copy = async (node: ThoughtNode, json = false) => {
    const synthesis = node.synthesis;
    if (!synthesis && !json) return;
    const text = json
      ? JSON.stringify(node.raw ?? { prompt: node.prompt, stage: node.stage, agents: node.agents }, null, 2)
      : [synthesis?.title, synthesis?.summary, synthesis?.insights.join('\n'), synthesis?.nextStep]
        .filter(Boolean)
        .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(`${node.id}-${json}`);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedId(null), 1800);
    } catch {
      notify('Copy is unavailable. Expand the details to select and copy the text.');
    }
  };

  function exportSkills() {
    const chosen = nodesRef.current.filter((node) => node.picked && node.synthesis);
    if (!chosen.length) return;
    const markdown = [
      '# FastFusion Exported Skills',
      '',
      '> Reusable syntheses selected from a multi-model comparison session.',
      '',
      ...chosen.flatMap((node, index) => {
        const synthesis = node.synthesis!;
        return [
          `## ${index + 1}. ${synthesis.title || node.prompt}`,
          '',
          `**Question:** ${node.prompt}`,
          '',
          '### Recommended approach',
          '',
          synthesis.summary,
          '',
          ...(synthesis.insights.length
            ? ['### Reusable principles', '', ...synthesis.insights.map((insight) => `- ${insight}`), '']
            : []),
          ...(synthesis.nextStep ? ['### Next step', '', synthesis.nextStep, ''] : []),
        ];
      }),
    ].join('\n');

    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'fastfusion-skills.md';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    notify(`Exported ${chosen.length} block${chosen.length > 1 ? 's' : ''} as Markdown`);
  }

  function saveToFile() {
    const snapshot = buildSnapshot(
      nodesRef.current, viewRef.current, selectedRef.current, new Date().toISOString(), nameRef.current,
    );
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = fileNameFor(snapshot.name);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    notify(`Saved ${snapshot.nodes.length} block${snapshot.nodes.length === 1 ? '' : 's'}`);
  }

  async function loadFromFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || activeRef.current) return;
    try {
      const snapshot = parseSnapshot(JSON.parse(await file.text()));
      if (!snapshot) {
        notify('That file is not a FastFusion canvas.');
        return;
      }
      clearTimeout(closeTimer.current);
      cutGlide();
      setNodes(snapshot.nodes);
      setView(snapshot.view);
      setSelectedId(snapshot.selectedId);
      setCanvasName(nameFromFile(file.name));
      setRenaming(false);
      setPanelOpen(false);
      notify(`Loaded ${snapshot.nodes.length} block${snapshot.nodes.length === 1 ? '' : 's'}`);
    } catch {
      notify('That file could not be read.');
    }
  }

  function startRenaming() {
    setNameDraft(canvasName === DEFAULT_CANVAS_NAME ? '' : canvasName);
    setRenaming(true);
  }

  function commitName() {
    setCanvasName(normaliseName(nameDraft));
    setRenaming(false);
  }

  const choose = (id: string) => { setSelectedId(id); clearTimeout(closeTimer.current); };
  const follow = (node: ThoughtNode) => { choose(node.id); inputRef.current?.focus(); };

  const reset = () => {
    if (activeRef.current) return;
    clearTimeout(closeTimer.current);
    clearCanvas();
    setCanvasName(DEFAULT_CANVAS_NAME);
    setRenaming(false);
    setNodes([]);
    setSelectedId(null);
    setPanelOpen(false);
    setPrompt('');
    inputRef.current?.focus();
  };

  const zoom = (delta: number) => { glide(); setView((v) => {
    const scale = Math.min(MAX_ZOOM, Math.max(0.35, v.scale + delta));
    const cx = window.innerWidth / 2;
    const cy = (window.innerHeight - 180) / 2;
    return { x: cx - ((cx - v.x) * scale) / v.scale, y: cy - ((cy - v.y) * scale) / v.scale, scale };
  }); };

  const fit = () => {
    if (!nodes.length) return;
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxX = Math.max(...nodes.map((n) => n.x + WIDTH));
    const maxY = Math.max(...nodes.map((n) => n.y + (
      document.querySelector<HTMLElement>(`[data-node-id="${n.id}"]`)?.getBoundingClientRect().height
      || 600 * view.scale
    ) / view.scale));
    const h = window.innerHeight - (panelOpen ? 400 : 250);
    const w = window.innerWidth - 70;
    const scale = Math.max(MIN_ZOOM, Math.min(1, w / (maxX - minX), Math.max(180, h) / (maxY - minY)));
    glide();
    setView({
      scale,
      x: window.innerWidth / 2 - ((minX + maxX) / 2) * scale,
      y: 95 + (Math.max(180, h) - (maxY - minY) * scale) / 2 - minY * scale,
    });
  };

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('[data-node],button')) return;
    cutGlide();
    gesture.current = { kind: 'pan', x: event.clientX, y: event.clientY, originX: view.x, originY: view.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const beginNode = (event: ReactPointerEvent<HTMLElement>, node: ThoughtNode) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    event.stopPropagation();
    cutGlide();
    choose(node.id);
    gesture.current = {
      kind: 'node', id: node.id, x: event.clientX, y: event.clientY, originX: node.x, originY: node.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const move = (event: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    if (g.kind === 'pan') setView((v) => ({ ...v, x: g.originX + dx, y: g.originY + dy }));
    else updateNode(g.id!, { x: g.originX + dx / view.scale, y: g.originY + dy / view.scale });
  };

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const wheel = (event: WheelEvent) => {
      // Let the JSON drawer and a long prompt title scroll natively.
      if ((event.target as HTMLElement).closest('.raw-content,.prompt-title')) return;
      event.preventDefault();
      cutGlide();
      if (event.ctrlKey || event.metaKey) {
        setView((v) => {
          const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.scale * Math.exp(-event.deltaY * 0.006)));
          return {
            x: event.clientX - ((event.clientX - v.x) * scale) / v.scale,
            y: event.clientY - ((event.clientY - v.y) * scale) / v.scale,
            scale,
          };
        });
      } else {
        setView((v) => ({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }));
      }
    };
    surface.addEventListener('wheel', wheel, { passive: false });
    return () => surface.removeEventListener('wheel', wheel);
  }, [cutGlide]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === 'Escape') setPanelOpen(false);
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      abortRef.current?.abort();
      clearTimeout(closeTimer.current);
      clearTimeout(copyTimer.current);
      clearTimeout(toastTimer.current);
      clearTimeout(glideTimer.current);
    };
  }, []);

  useEffect(() => {
    if (current?.stage === 'complete' && !panelOpen && !gesture.current) {
      const frame = requestAnimationFrame(() => { if (!gesture.current) centerNode(current); });
      return () => cancelAnimationFrame(frame);
    }
  }, [current?.id, current?.stage, panelOpen, centerNode]);

  // Autosave, so a refresh comes back to the same canvas.
  useEffect(() => {
    if (!nodes.length) return;
    saveCanvas(buildSnapshot(nodes, view, selectedId, new Date().toISOString(), canvasName));
  }, [nodes, view, selectedId, canvasName]);

  useEffect(() => {
    const resize = () => {
      const node = nodesRef.current.find((n) => n.id === selectedRef.current);
      if (node) centerNode(node);
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [centerNode]);

  const scored = activity
    ? [...activity.agents].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    : [];
  const winnerAgent = activity?.agents.find((agent) => agent.id === activity.winnerId);

  return (
    <main className={`workspace ${started ? 'has-nodes' : ''}`}>
      <div
        className="dot-grid"
        style={started ? {
          backgroundSize: `${24 * view.scale}px ${24 * view.scale}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        } : undefined}
      />

      {/* The bar is bare on an empty canvas: only Load stays, so a saved file is
          never out of reach. */}
      <header className={`topbar ${started ? '' : 'is-bare'}`}>
        {started && (
          <div className="brand">
            <span className="brand-symbol"><GitBranch size={20} /></span>
            <b>fastfusion</b>
            <span className="canvas-name">
              {renaming ? (
                <input
                  autoFocus
                  aria-label="Canvas name"
                  value={nameDraft}
                  maxLength={60}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onBlur={commitName}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); commitName(); }
                    if (event.key === 'Escape') { event.preventDefault(); setRenaming(false); }
                  }}
                />
              ) : (
                <b
                  role="button"
                  tabIndex={0}
                  title="Double-click to rename"
                  onDoubleClick={startRenaming}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); startRenaming(); }
                  }}
                >
                  {canvasName}
                </b>
              )}
            </span>
          </div>
        )}
        <div className="top-actions">
          {pickedCount > 0 && (
            <button type="button" className="export-button" onClick={exportSkills}>
              <Download size={14} />
              Export Skills <i>{pickedCount}</i>
            </button>
          )}
          {started && (
            <button
              className="icon-button reset"
              aria-label="Save canvas"
              title="Save canvas to a file"
              onClick={saveToFile}
            >
              <Save size={17} />
            </button>
          )}
          <button
            className="icon-button reset"
            aria-label="Load canvas"
            title="Load a canvas file"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            <FolderOpen size={17} />
          </button>
          {started && (
            <button
              className="icon-button reset"
              aria-label="Clear canvas"
              title="Clear canvas"
              disabled={busy}
              onClick={reset}
            >
              <RotateCcw size={17} />
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Canvas file"
            onChange={loadFromFile}
          />
        </div>
      </header>

      <div
        ref={surfaceRef}
        className="canvas-surface"
        aria-label="Thinking canvas. Drag the background to pan."
        onPointerDown={beginPan}
        onPointerMove={move}
        onPointerUp={() => { gesture.current = null; }}
        onPointerCancel={() => { gesture.current = null; }}
      >
        <div
          className={`canvas-world ${gliding ? 'gliding' : ''}`}
          style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})` }}
        >
          <svg className="connections" aria-hidden="true">
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M1 1L7 4L1 7" fill="none" stroke="#7e8ca0" strokeWidth="1.3" />
              </marker>
            </defs>
            {nodes.filter((node) => node.parentId).map((node) => {
              const parent = nodes.find((candidate) => candidate.id === node.parentId);
              if (!parent) return null;
              const x1 = parent.x + WIDTH + 5;
              const y1 = parent.y + 62;
              const x2 = node.x - 8;
              const y2 = node.y + 62;
              return (
                <g key={node.id}>
                  <path
                    d={`M${x1},${y1} C${x1 + 65},${y1} ${x2 - 65},${y2} ${x2},${y2}`}
                    stroke={node.id === selectedId ? '#8195b0' : '#b5beca'}
                    strokeWidth="1.6"
                    fill="none"
                    markerEnd="url(#arrowhead)"
                  />
                  <circle cx={x1} cy={y1} r="3" fill="#98a6b9" />
                </g>
              );
            })}
          </svg>

          {nodes.map((node, index) => {
            const isBusy = busyStages.includes(node.stage);
            const winner = node.agents.find((agent) => agent.id === node.winnerId);
            const synthesis = node.synthesis;
            const payload = node.raw ?? { prompt: node.prompt, stage: node.stage, agents: node.agents };
            return (
              <article
                data-node
                data-node-id={node.id}
                key={node.id}
                className={`node-stack ${selectedId === node.id ? 'selected' : ''} ${isBusy ? 'is-loading' : ''} ${node.stage === 'error' ? 'is-failed' : ''} ${node.expanded ? 'raw-expanded' : ''}`}
                style={{ left: node.x, top: node.y, width: WIDTH }}
                onClick={() => choose(node.id)}
              >
                {/* The raw payload sits behind the card as a peeking sheet. */}
                <section className="raw-layer">
                  {node.expanded ? (
                    <div className="raw-content">
                      <header><span>Raw response</span><span>JSON</span></header>
                      <label>Prompt</label>
                      <p>{node.prompt}</p>
                      <label>Payload</label>
                      <pre tabIndex={0} aria-label={`Block ${index + 1} raw JSON`}>
                        {JSON.stringify(payload, null, 2)}
                      </pre>
                      <button
                        type="button"
                        aria-label="Close raw response"
                        onClick={(event) => { event.stopPropagation(); updateNode(node.id, { expanded: false }); }}
                      >
                        Return to summary
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="raw-peek"
                      aria-label="Open raw response"
                      aria-expanded={false}
                      onClick={(event) => { event.stopPropagation(); updateNode(node.id, { expanded: true }); }}
                    >
                      <span>Raw response</span><span>Open</span>
                    </button>
                  )}
                </section>

                <section className="thought-card">
                  <header
                    className="node-header"
                    onPointerDown={(event) => beginNode(event, node)}
                    tabIndex={0}
                    role="button"
                    aria-label={`Select or drag block ${index + 1}`}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(node.id); }
                    }}
                  >
                    <span className="node-type">Block {index + 1}</span>
                    <Grip size={15} className="drag-grip" />
                  </header>

                  <div className="node-content">
                    {synthesis ? (
                      <>
                        <div className="answer-label"><span className="tiny-spark">✳</span> Selected response</div>
                        <h2>{synthesis.title || node.prompt}</h2>
                        <p className="answer-intro">{synthesis.summary}</p>
                        {synthesis.insights.length > 0 && (
                          <ol className="answer-points">
                            {synthesis.insights.map((insight, i) => (
                              <li key={insight}><span>{String(i + 1).padStart(2, '0')}</span><p>{insight}</p></li>
                            ))}
                          </ol>
                        )}
                        {synthesis.nextStep && <p className="next-thought">{synthesis.nextStep}</p>}
                      </>
                    ) : isBusy ? (
                      <>
                        <div className="answer-label">
                          <LoaderCircle size={14} className="spin" /> {stageLabels[node.stage]}
                        </div>
                        <h2 className="prompt-title">{node.prompt}</h2>
                        <div className="skeleton-stack"><div /><div /><div /></div>
                      </>
                    ) : (
                      <>
                        <div className="answer-label">{stageLabels[node.stage]}</div>
                        <h2 className="prompt-title">{node.prompt}</h2>
                        <p className="answer-intro">
                          {node.error || 'You can run this prompt again whenever you are ready.'}
                        </p>
                        <button
                          className="retry-button"
                          disabled={busy}
                          onClick={(event) => { event.stopPropagation(); void run(node.id, node.prompt, true); }}
                        >
                          <RotateCcw size={14} />Try again
                        </button>
                      </>
                    )}
                  </div>

                  <footer className="node-footer">
                    <div className="winner-label">
                      {winner ? (
                        <>
                          <b>{winner.name}</b>
                          <span className="score-badge">{node.score ?? winner.score}<small>/100</small></span>
                        </>
                      ) : (
                        <>
                          <span className={`status-dot ${isBusy ? 'pulsing' : ''}`} />
                          {isBusy ? `${AGENT_TEMPLATE.length} models at work` : stageLabels[node.stage]}
                        </>
                      )}
                    </div>
                    {synthesis && (
                      <div className="node-footer-actions">
                        <button
                          className={`pick-button ${node.picked ? 'picked' : ''}`}
                          aria-label={node.picked ? `Remove block ${index + 1} from the export` : `Add block ${index + 1} to the export`}
                          aria-pressed={node.picked}
                          title="Include in the Markdown skills export"
                          onClick={(event) => { event.stopPropagation(); updateNode(node.id, { picked: !node.picked }); }}
                        >
                          {node.picked ? <Check size={14} /> : <Download size={14} />}
                        </button>
                        <button
                          className="icon-button"
                          title="Copy response"
                          aria-label="Copy response"
                          onClick={(event) => { event.stopPropagation(); void copy(node); }}
                        >
                          {copiedId === `${node.id}-false` ? <Check size={15} /> : <Copy size={15} />}
                        </button>
                        <button
                          className="continue-button"
                          onClick={(event) => { event.stopPropagation(); follow(node); }}
                        >
                          Continue<ArrowUpRight size={15} />
                        </button>
                      </div>
                    )}
                  </footer>
                </section>
              </article>
            );
          })}
        </div>
      </div>

      {started && (
        <aside className="canvas-controls" aria-label="Canvas zoom">
          <button aria-label="Zoom out" onClick={() => zoom(-0.1)}><Minus size={16} /></button>
          <span>{Math.round(view.scale * 100)}%</span>
          <button aria-label="Zoom in" onClick={() => zoom(0.1)}><Plus size={16} /></button>
          <div />
          <button aria-label="Fit all nodes" title="Fit all nodes" onClick={fit}><Expand size={16} /></button>
        </aside>
      )}

      <section className={`dock ${panelOpen ? 'expanded' : ''}`}>
        {activity && (
          <div className="activity-shell">
            <button
              className={`activity-bar ${panelOpen ? 'active' : ''}`}
              aria-expanded={panelOpen}
              aria-controls="agent-workspace"
              onClick={() => { clearTimeout(closeTimer.current); setPanelOpen((open) => !open); }}
            >
              <span className="activity-bar-left">
                {busy ? <LoaderCircle className="spin" size={14} />
                  : activity.stage === 'complete' ? <Check size={14} />
                    : <Square size={12} />}
                <b>{stageLabels[activity.stage]}</b>
                {winnerAgent && (
                  <span className="activity-description">
                    {`${winnerAgent.name} · ${activity.score ?? winnerAgent.score} points`}
                  </span>
                )}
              </span>
              <span className="activity-bar-right">
                {panelOpen ? 'Hide activity' : 'View activity'}
                <ChevronDown size={14} className={panelOpen ? 'rotate-180' : ''} />
              </span>
            </button>

            {/* Always mounted so the open/close height can animate. */}
            <div className={`workspace-reveal ${panelOpen ? 'open' : ''}`}>
              <div className="agent-workspace" id="agent-workspace" aria-hidden={!panelOpen}>
                <div className="panel-heading"><span>Model workspace</span></div>
                <div className="agents-grid">
                  {scored.map((agent, i) => {
                    const won = activity.winnerId === agent.id;
                    return (
                      <div
                        className={`agent-card ${won ? 'winner' : ''} ${agent.status === 'failed' ? 'failed' : ''}`}
                        key={agent.id}
                      >
                        <div className="agent-title">
                          <span className="agent-avatar" style={{ background: agent.color }}>
                            {agent.name.slice(0, 1)}
                          </span>
                          <div><b>{agent.name}</b><small>{agent.role}</small></div>
                          <span className="agent-progress">
                            {agent.score !== undefined ? <strong>{agent.score}<small>/100</small></strong>
                              : agent.status === 'failed' ? <X size={16} />
                                : agent.status === 'complete' ? <Check size={17} />
                                  : <LoaderCircle size={15} className="spin" />}
                          </span>
                        </div>
                        {agent.preview ? (
                          <p title={agent.reason}>{agent.preview}</p>
                        ) : agent.status === 'complete' ? (
                          <p>Response ready. Waiting for evaluation.</p>
                        ) : (
                          <div className="agent-skeleton" aria-hidden="true">
                            <span /><span /><span />
                          </div>
                        )}
                        <div className="agent-bottom">
                          <span>
                            {agent.status === 'failed' ? 'Failed'
                              : agent.score !== undefined ? (won ? 'Top score' : 'Evaluated')
                                : agent.status === 'complete' ? 'Response ready' : 'Thinking'}
                          </span>
                          {won ? <Trophy size={12} /> : (
                            <div className={`agent-line ${agent.status !== 'running' ? 'finished' : ''}`}><span /></div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="synthesis-row">
                  <span>
                    <b>Synthesis</b>
                    {activity.stage !== 'complete' && (
                      <span>
                        {activity.stage === 'summarizing'
                          ? 'Refining the best response…'
                          : 'Waiting for the top response'}
                      </span>
                    )}
                  </span>
                  {activity.stage === 'complete' ? <Check size={15} /> : (
                    <span className="local-tag">{USE_MOCK ? 'Mock' : 'Nex Pro'}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <form className="command" onSubmit={(event) => { event.preventDefault(); void submit(prompt); }}>
          <div className="command-icon"><Terminal size={22} /></div>
          <div className="input-area">
            {current?.stage === 'complete' && (
              <button
                type="button"
                className="context-chip"
                title="Focus the selected node"
                onClick={() => centerNode(current, Math.min(1, (window.innerWidth - 40) / WIDTH))}
              >
                <GitBranch size={12} />
                Continue from {String(nodes.indexOf(current) + 1).padStart(2, '0')}
                <ChevronRight size={12} />
              </button>
            )}
            <textarea
              ref={inputRef}
              rows={1}
              aria-label="Your prompt"
              placeholder="Write a message..."
              value={prompt}
              maxLength={2000}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey
                  && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                  event.preventDefault();
                  void submit(prompt);
                }
              }}
            />
          </div>
          {busy ? (
            <button
              type="button"
              aria-label="Stop exploration"
              className="send-button stop-button"
              onClick={() => abortRef.current?.abort()}
            >
              <Square size={16} fill="currentColor" />
            </button>
          ) : (
            <button type="submit" aria-label="Submit prompt" className="send-button" disabled={!prompt.trim()}>
              <ArrowUp size={21} />
            </button>
          )}
        </form>
      </section>

      <div className="sr-only" aria-live="polite">{activity ? stageLabels[activity.stage] : ''}</div>

      {toast && (
        <div className="toast" role="status">
          {toast}
          <button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
    </main>
  );
}
