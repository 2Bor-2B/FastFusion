import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, PointerEvent as ReactPointerEvent } from 'react';
import { AGENT_TEMPLATE, runMockAgents } from './mockApi';
import type { AgentRun } from './mockApi';

type Phase = 'idle' | 'benchmarking' | 'summarizing' | 'complete';

type ThoughtNode = {
  id: string;
  parentId?: string;
  prompt: string;
  status: 'loading' | 'summarizing' | 'complete';
  summary?: string;
  insights?: string[];
  raw?: Record<string, unknown>;
  score?: number;
  x: number;
  y: number;
};

type Viewport = { x: number; y: number; scale: number };
type NodeDrag = {
  id: string;
  pointerId: number;
  scale: number;
  clientX: number;
  clientY: number;
  originX: number;
  originY: number;
};

const INITIAL_VIEWPORT: Viewport = { x: 90, y: 30, scale: 1 };
const NODE_WIDTH = 430;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.45;

function statusLabel(status: AgentRun['status']) {
  if (status === 'running') return 'RUNNING';
  if (status === 'complete') return 'COMPLETE';
  if (status === 'failed') return 'FAILED';
  return 'QUEUED';
}

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [agents, setAgents] = useState<AgentRun[]>(AGENT_TEMPLATE.map((agent) => ({ ...agent })));
  const [winnerId, setWinnerId] = useState<string>();
  const [nodes, setNodes] = useState<ThoughtNode[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string>();
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [viewport, setViewport] = useState<Viewport>(INITIAL_VIEWPORT);
  const [draggingNodeId, setDraggingNodeId] = useState<string>();
  const [exported, setExported] = useState(false);
  const [isBenchmarkExpanded, setIsBenchmarkExpanded] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{ clientX: number; clientY: number; originX: number; originY: number } | null>(null);
  const nodeDragRef = useRef<NodeDrag | null>(null);

  const isProcessing = phase === 'benchmarking' || phase === 'summarizing';
  const selectedCount = selectedNodes.size;
  const benchmarkStateLabel = phase === 'summarizing' ? 'SUMMARIZING' : phase === 'complete' ? 'WINNER SELECTED' : 'EVALUATING';

  const connections = useMemo(() => nodes.flatMap((node) => {
    if (!node.parentId) return [];
    const parent = nodes.find((candidate) => candidate.id === node.parentId);
    return parent ? [{ id: `${parent.id}-${node.id}`, from: parent, to: node }] : [];
  }), [nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wheelHandler = (event: globalThis.WheelEvent) => handleWheel(event);
    canvas.addEventListener('wheel', wheelHandler, { passive: false });
    return () => canvas.removeEventListener('wheel', wheelHandler);
  }, [nodes.length]);

  async function submitPrompt(event?: FormEvent) {
    event?.preventDefault();
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt || isProcessing) return;

    const id = `trace-${Date.now()}`;
    const parentId = activeNodeId ?? nodes.at(-1)?.id;
    const nextNode: ThoughtNode = {
      id,
      parentId,
      prompt: cleanPrompt,
      status: 'loading',
      x: 120 + nodes.length * (NODE_WIDTH + 120),
      y: 245,
    };

    setNodes((current) => [...current, nextNode]);
    setActiveNodeId(id);
    setPrompt('');
    setAgents(AGENT_TEMPLATE.map((agent) => ({ ...agent })));
    setWinnerId(undefined);
    setExpandedNodes((current) => { const next = new Set(current); next.delete(id); return next; });
    setIsBenchmarkExpanded(true);
    setPhase('benchmarking');

    const result = await runMockAgents(cleanPrompt, setAgents, (winner) => {
      setWinnerId(winner);
      setPhase('summarizing');
      setNodes((current) => current.map((node) => node.id === id ? { ...node, status: 'summarizing' } : node));
    });

    setWinnerId(result.winnerId);
    setNodes((current) => current.map((node) => node.id === id ? {
      ...node,
      status: 'complete',
      summary: result.summary,
      insights: result.insights,
      raw: result.raw,
      score: 92,
    } : node));
    setPhase('complete');
  }

  function toggleExpanded(id: string) {
    setExpandedNodes((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelected(id: string) {
    setSelectedNodes((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function exportSkills() {
    const chosen = nodes.filter((node) => selectedNodes.has(node.id));
    if (!chosen.length) return;
    const markdown = [
      '# TraceLab Exported Skills',
      '',
      '> Reusable execution summaries selected from an Agent comparison session.',
      '',
      ...chosen.flatMap((node, index) => [
        `## ${index + 1}. ${node.prompt}`,
        '',
        '### Recommended approach',
        '',
        node.summary ?? 'Summary pending.',
        '',
        '### Reusable principles',
        '',
        ...(node.insights ?? []).map((insight) => `- ${insight}`),
        '',
      ]),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tracelab-skills.md';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setExported(true);
    window.setTimeout(() => setExported(false), 2200);
  }

  function beginPan(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('[data-node], [data-control]')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { clientX: event.clientX, clientY: event.clientY, originX: viewport.x, originY: viewport.y };
  }

  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!panRef.current) return;
    setViewport((current) => ({
      ...current,
      x: panRef.current!.originX + event.clientX - panRef.current!.clientX,
      y: panRef.current!.originY + event.clientY - panRef.current!.clientY,
    }));
  }

  function stopPan() { panRef.current = null; }

  function beginNodeDrag(event: ReactPointerEvent<HTMLElement>, node: ThoughtNode) {
    const target = event.target instanceof Element ? event.target : null;
    if (nodeDragRef.current || event.button !== 0 || target?.closest('button, label, input, textarea, pre')) return;

    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setActiveNodeId(node.id);
    setDraggingNodeId(node.id);
    nodeDragRef.current = {
      id: node.id,
      pointerId: event.pointerId,
      scale: viewport.scale,
      clientX: event.clientX,
      clientY: event.clientY,
      originX: node.x,
      originY: node.y,
    };
  }

  function moveNodeDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.stopPropagation();
    const x = drag.originX + (event.clientX - drag.clientX) / drag.scale;
    const y = drag.originY + (event.clientY - drag.clientY) / drag.scale;
    setNodes((current) => current.map((node) => node.id === drag.id ? { ...node, x, y } : node));
  }

  function stopNodeDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    nodeDragRef.current = null;
    setDraggingNodeId(undefined);
  }

  function zoom(delta: number, anchor?: { x: number; y: number }) {
    const rect = canvasRef.current?.getBoundingClientRect();
    const zoomAnchor = anchor ?? {
      x: rect?.width ? rect.width / 2 : window.innerWidth / 2,
      y: rect?.height ? rect.height / 2 : window.innerHeight / 2,
    };

    setViewport((current) => {
      const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.scale + delta));
      if (scale === current.scale) return current;

      const worldX = (zoomAnchor.x - current.x) / current.scale;
      const worldY = (zoomAnchor.y - current.y) / current.scale;
      return {
        scale,
        x: zoomAnchor.x - worldX * scale,
        y: zoomAnchor.y - worldY * scale,
      };
    });
  }

  function handleWheel(event: globalThis.WheelEvent) {
    if (nodeDragRef.current) {
      event.preventDefault();
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    const isInsideJsonDocument = Boolean(target?.closest('[data-json-scroll]'));

    // Let the browser preserve native wheel/trackpad scrolling (and inertia)
    // while the pointer is over a JSON document. Pinch-to-zoom still belongs
    // to the canvas because browsers expose it with ctrlKey/metaKey enabled.
    if (isInsideJsonDocument && !event.ctrlKey && !event.metaKey) return;

    event.preventDefault();
    if (!nodes.length) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Browsers expose trackpad pinch as a wheel event with ctrlKey enabled.
    // Regular two-finger scrolling has no modifier and should pan the canvas.
    if (event.ctrlKey || event.metaKey) {
      const rect = canvas.getBoundingClientRect();
      const delta = Math.max(-0.12, Math.min(0.12, -event.deltaY * 0.005));
      zoom(delta, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      return;
    }

    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
    const horizontal = (event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX) * unit;
    const vertical = (event.shiftKey ? 0 : event.deltaY) * unit;
    setViewport((current) => ({
      ...current,
      x: current.x - horizontal,
      y: current.y - vertical,
    }));
  }

  return (
    <main className={`app-frame ${nodes.length ? 'has-nodes' : ''}`}>
      <header className="topbar">
        <div className="wordmark"><span>TRACE<span>LAB</span></span><em>/ AGENT CANVAS</em></div>
      </header>

      {selectedCount > 0 && (
        <div className="export-cluster" data-control>
          <span>{selectedCount} BLOCK{selectedCount > 1 ? 'S' : ''} SELECTED</span>
          <button type="button" onClick={exportSkills}>Export Skills</button>
        </div>
      )}
      {exported && <div className="export-toast">Markdown skill exported</div>}

      <div
        ref={canvasRef}
        className={`canvas ${nodes.length ? 'has-nodes' : ''}`}
        aria-label="Agent 思考路径画布"
        onPointerDown={beginPan}
        onPointerMove={movePan}
        onPointerUp={stopPan}
        onPointerCancel={stopPan}
      >
        {!nodes.length && <div className="idle-mark" aria-hidden="true"><p>YOUR QUESTION BECOMES A MAP</p></div>}

        <div className="canvas-world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}>
          <svg className="connections" width="2400" height="1000" aria-hidden="true">
            <defs>
              <marker id="connection-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M1 1L7 4L1 7Z" fill="#5e83bb" />
              </marker>
            </defs>
            {connections.map(({ id, from, to }) => {
              const direction = to.x + NODE_WIDTH / 2 >= from.x + NODE_WIDTH / 2 ? 1 : -1;
              const x1 = direction === 1 ? from.x + NODE_WIDTH : from.x;
              const x2 = direction === 1 ? to.x - 8 : to.x + NODE_WIDTH + 8;
              const y1 = from.y + 116;
              const y2 = to.y + 116;
              const bend = Math.max(70, Math.abs(x2 - x1) * .35);
              return <path key={id} d={`M ${x1} ${y1} C ${x1 + direction * bend} ${y1}, ${x2 - direction * bend} ${y2}, ${x2} ${y2}`} markerEnd="url(#connection-arrow)" />;
            })}
          </svg>

          {nodes.map((node, index) => {
            const expanded = expandedNodes.has(node.id);
            const selected = selectedNodes.has(node.id);
            return (
              <article
                data-node
                key={node.id}
                className={`node-stack ${expanded ? 'raw-expanded' : ''} ${activeNodeId === node.id ? 'active' : ''} ${draggingNodeId === node.id ? 'dragging' : ''}`}
                style={{ left: node.x, top: node.y }}
                onClick={() => setActiveNodeId(node.id)}
                onPointerDown={(event) => beginNodeDrag(event, node)}
                onPointerMove={moveNodeDrag}
                onPointerUp={stopNodeDrag}
                onPointerCancel={stopNodeDrag}
                onLostPointerCapture={stopNodeDrag}
              >
                <section className="raw-layer" aria-label={`原始数据 ${index + 1}`}>
                  {!expanded ? (
                    <button className="raw-peek" type="button" onClick={(event) => { event.stopPropagation(); toggleExpanded(node.id); }} disabled={!node.raw} aria-label="展开原始 JSON">
                      <span>RAW RESPONSE</span><span>OPEN</span>
                    </button>
                  ) : (
                    <div className="raw-content">
                      <header><span>RAW RESPONSE</span><span>JSON</span></header>
                      <label>PROMPT</label><p>{node.prompt}</p>
                      <label>PAYLOAD</label><pre data-json-scroll tabIndex={0} style={{ overscrollBehavior: 'contain' }} aria-label={`节点 ${index + 1} 原始 JSON 文档`}>{JSON.stringify(node.raw, null, 2)}</pre>
                      <button type="button" onClick={(event) => { event.stopPropagation(); toggleExpanded(node.id); }} aria-label="收起原始 JSON">Return to summary</button>
                    </div>
                  )}
                </section>

                <section className="thought-card">
                  <header className="node-header">
                    <span className="node-index">{String(index + 1).padStart(2, '0')}</span>
                    <div><strong>{node.parentId ? 'FOLLOW-UP SYNTHESIS' : 'PRIMARY SYNTHESIS'}</strong></div>
                    <label className="node-check" onClick={(event) => event.stopPropagation()}>
                      <input type="checkbox" checked={selected} onChange={() => toggleSelected(node.id)} aria-label={`选择节点 ${index + 1}`} />
                      <span>{selected ? 'SELECTED' : 'SELECT'}</span>
                    </label>
                  </header>

                  {node.status !== 'complete' ? (
                    <div className="node-loading">
                      <strong>{node.status === 'summarizing' ? 'SYNTHESIZING WINNER' : 'COMPARING AGENTS'}</strong>
                      <p>{node.status === 'summarizing' ? 'Local model is compressing the best answer' : 'Running benchmark and evaluating candidates'}</p>
                      <div className="loading-line"><span /></div>
                    </div>
                  ) : (
                    <div className="node-result">
                      <div className="result-score"><span>SYNTHESIS COMPLETE</span><strong>{node.score}<small>/100</small></strong></div>
                      <h2>{node.prompt}</h2>
                      <p>{node.summary}</p>
                      <ul>{node.insights?.map((insight, insightIndex) => <li key={insight}><span>{insightIndex + 1}</span>{insight}</li>)}</ul>
                    </div>
                  )}
                  <footer><span>TRACE {node.id.split('-').at(-1)?.slice(-5).toUpperCase()}</span><span>PUBLIC RATIONALE SUMMARY</span></footer>
                </section>
              </article>
            );
          })}
        </div>
      </div>

      <section className={`command-dock ${phase !== 'idle' ? 'expanded' : ''}`} aria-label="Prompt command line" data-control>
        {phase !== 'idle' && (
          <div className={`benchmark-panel ${isBenchmarkExpanded ? '' : 'is-collapsed'}`}>
            <header>
              <div><span className="eyebrow">LIVE BENCHMARK</span><h2>{isProcessing ? 'Agents are working' : 'Comparison complete'}</h2></div>
              <div className="benchmark-actions">
                <div className="benchmark-state" role="status" aria-label={benchmarkStateLabel} aria-live="polite" aria-atomic="true"><span className="benchmark-state-label" aria-hidden="true">{benchmarkStateLabel}</span></div>
                <button
                  className="benchmark-toggle"
                  type="button"
                  onClick={() => setIsBenchmarkExpanded((current) => !current)}
                  aria-expanded={isBenchmarkExpanded}
                  aria-controls="benchmark-details"
                  aria-label={isBenchmarkExpanded ? '收起 Benchmark' : '展开 Benchmark'}
                  title={isBenchmarkExpanded ? '收起 Benchmark' : '展开 Benchmark'}
                >
                  {isBenchmarkExpanded ? 'HIDE' : 'SHOW'}
                </button>
              </div>
            </header>
            <div id="benchmark-details" className="benchmark-details" role="region" aria-label="Agent Benchmark 详情" aria-busy={isProcessing} hidden={!isBenchmarkExpanded}>
              <div className="agent-grid">
                {agents.map((agent) => {
                  const winner = winnerId === agent.id;
                  return <div className={`agent-row ${winner ? 'winner' : ''}`} key={agent.id}>
                    <div className="agent-name"><strong>{agent.name}</strong><small>{agent.model}</small></div>
                    <div className="agent-progress"><span style={{ width: agent.status === 'complete' ? `${agent.score}%` : agent.status === 'running' ? '58%' : '8%' }} /></div>
                    <span className={`agent-status ${agent.status}`}>{statusLabel(agent.status)}</span>
                    <strong className="agent-score">{agent.score ?? 'N/A'}{agent.score && <small>/100</small>}</strong>
                    {winner && <span className="winner-tag">WINNER</span>}
                  </div>;
                })}
              </div>
            </div>
          </div>
        )}

        <form className="prompt-form" onSubmit={submitPrompt}>
          <textarea
            rows={1}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submitPrompt(); }
            }}
            placeholder={nodes.length ? 'Ask a follow-up to extend this trace' : 'Ask anything. We’ll compare the agents'}
            aria-label="输入问题"
            disabled={isProcessing}
          />
          <div className="prompt-meta"><span>{isProcessing ? 'Agents busy' : 'Run benchmark'}</span><button type="submit" disabled={!prompt.trim() || isProcessing} aria-label="提交问题">{isProcessing ? 'WAIT' : 'RUN'}</button></div>
        </form>
      </section>
    </main>
  );
}
