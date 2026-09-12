import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

async function finishAnalysis() {
  await act(async () => { await vi.runAllTimersAsync(); });
}

describe('TraceLab Agent Canvas', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:skills') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  afterEach(() => vi.useRealTimers());

  it('submits a question and completes agent scoring and synthesis', async () => {
    render(<App />);
    expect(screen.queryByText('LIVE BENCHMARK')).not.toBeInTheDocument();
    const input = screen.getByLabelText('Question input');
    fireEvent.change(input, { target: { value: 'How should I design a reliable AI agent?' } });
    fireEvent.click(screen.getByLabelText('Submit question'));
    expect(screen.getByText('LIVE BENCHMARK')).toBeInTheDocument();
    expect(screen.getByText('COMPARING AGENTS')).toBeInTheDocument();
    await finishAnalysis();
    expect(screen.getByText('WINNER')).toBeInTheDocument();
    expect(screen.getByText('SYNTHESIS COMPLETE')).toBeInTheDocument();
    expect(screen.getAllByText('92', { exact: true })).toHaveLength(2);
  });

  it('collapses and expands the benchmark without losing its state', async () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: 'Collapse Benchmark' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Question input'), { target: { value: 'Test benchmark collapse' } });
    fireEvent.click(screen.getByLabelText('Submit question'));

    const collapseButton = screen.getByRole('button', { name: 'Collapse Benchmark' });
    const details = screen.getByRole('region', { name: 'Agent Benchmark details' });
    expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
    expect(details).not.toHaveAttribute('hidden');

    fireEvent.click(collapseButton);
    expect(screen.getByRole('button', { name: 'Expand Benchmark' })).toHaveAttribute('aria-expanded', 'false');
    expect(details).toHaveAttribute('hidden');
    expect(screen.getByText('EVALUATING')).toBeInTheDocument();

    await finishAnalysis();
    expect(details).toHaveAttribute('hidden');
    expect(screen.getByText('WINNER SELECTED')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand Benchmark' }));
    expect(screen.getByRole('button', { name: 'Collapse Benchmark' })).toHaveAttribute('aria-expanded', 'true');
    expect(details).not.toHaveAttribute('hidden');
  });

  it('reopens the benchmark when a follow-up is submitted', async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Question input'), { target: { value: 'First question' } });
    fireEvent.click(screen.getByLabelText('Submit question'));
    await finishAnalysis();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Benchmark' }));

    fireEvent.change(screen.getByLabelText('Question input'), { target: { value: 'Follow-up question' } });
    fireEvent.click(screen.getByLabelText('Submit question'));

    expect(screen.getByRole('button', { name: 'Collapse Benchmark' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Agent Benchmark details' })).not.toHaveAttribute('hidden');
  });

  it('opens raw JSON, selects a node, and exports Markdown skills', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<App />);
    fireEvent.change(screen.getByLabelText('Question input'), { target: { value: 'Improve team collaboration' } });
    fireEvent.click(screen.getByLabelText('Submit question'));
    await finishAnalysis();
    fireEvent.click(screen.getByLabelText('Open raw JSON for node 1'));
    expect(screen.getByText('PAYLOAD')).toBeInTheDocument();
    expect(screen.getByText(/selected_agent/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Select node 1'));
    expect(screen.getByRole('button', { name: 'Export Skills' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export Skills' }));
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(anchorClick).toHaveBeenCalledOnce();
    anchorClick.mockRestore();
  });

  it('copies summary and raw JSON content from their node headers', async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Question input'), { target: { value: 'Create a launch plan' } });
    fireEvent.click(screen.getByLabelText('Submit question'));
    await finishAnalysis();

    fireEvent.click(screen.getByLabelText('Copy summary for node 1'));
    await act(async () => { await Promise.resolve(); });
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(expect.stringContaining('Question: Create a launch plan'));
    expect(screen.getByLabelText('Copy summary for node 1')).toHaveTextContent('COPIED');

    fireEvent.click(screen.getByLabelText('Open raw JSON for node 1'));
    fireEvent.click(screen.getByLabelText('Copy raw JSON for node 1'));
    await act(async () => { await Promise.resolve(); });
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(expect.stringContaining('"selected_agent": "atlas"'));
    expect(screen.getByLabelText('Copy raw JSON for node 1')).toHaveTextContent('COPIED');
  });

  it('keeps prior nodes and connects follow-up questions', async () => {
    const { container } = render(<App />);
    fireEvent.change(screen.getByLabelText('Question input'), { target: { value: 'Draft the first plan' } });
    fireEvent.click(screen.getByLabelText('Submit question'));
    await finishAnalysis();
    fireEvent.change(screen.getByLabelText('Question input'), { target: { value: 'What if we only have one day?' } });
    fireEvent.click(screen.getByLabelText('Submit question'));
    expect(container.querySelectorAll('.node-stack')).toHaveLength(2);
    expect(screen.getByText('FOLLOW-UP SYNTHESIS')).toBeInTheDocument();
    await finishAnalysis();
    expect(screen.getAllByText('SYNTHESIS COMPLETE')).toHaveLength(2);
  });

  it('always connects arrows in node-number order', async () => {
    const { container } = render(<App />);

    for (const question of ['Node one', 'Node two']) {
      fireEvent.change(screen.getByLabelText('Question input'), { target: { value: question } });
      fireEvent.click(screen.getByLabelText('Submit question'));
      await finishAnalysis();
    }

    fireEvent.click(container.querySelectorAll<HTMLElement>('.node-stack')[0]);
    fireEvent.change(screen.getByLabelText('Question input'), { target: { value: 'Node three' } });
    fireEvent.click(screen.getByLabelText('Submit question'));

    const paths = container.querySelectorAll<SVGPathElement>('.connections > path');
    expect(paths).toHaveLength(2);
    expect(paths[0].getAttribute('d')).toMatch(/^M 550 361/);
    expect(paths[1].getAttribute('d')).toMatch(/^M 1100 361/);
  });

  it('updates a selected node position and its connection while dragging', async () => {
    const { container } = render(<App />);
    fireEvent.change(screen.getByLabelText('Question input'), { target: { value: 'Create parent node' } });
    fireEvent.click(screen.getByLabelText('Submit question'));
    await finishAnalysis();
    fireEvent.change(screen.getByLabelText('Question input'), { target: { value: 'Create child node' } });
    fireEvent.click(screen.getByLabelText('Submit question'));

    const nodes = container.querySelectorAll<HTMLElement>('.node-stack');
    const child = nodes[1];
    const connection = container.querySelector<SVGPathElement>('.connections > path');
    const pathBefore = connection?.getAttribute('d');

    fireEvent.pointerDown(child, { button: 0, pointerId: 7, clientX: 500, clientY: 300 });
    fireEvent.pointerMove(child, { pointerId: 7, clientX: 560, clientY: 340 });

    expect(child).toHaveClass('active', 'dragging');
    expect(child.style.left).toBe('730px');
    expect(child.style.top).toBe('285px');
    expect(connection?.getAttribute('d')).not.toBe(pathBefore);

    fireEvent.pointerUp(child, { pointerId: 7, clientX: 560, clientY: 340 });
    expect(child).not.toHaveClass('dragging');
  });

  it('keeps the world coordinate beneath the pointer fixed while zooming', () => {
    const { container } = render(<App />);
    fireEvent.change(screen.getByLabelText('Question input'), { target: { value: 'Test zoom anchor' } });
    fireEvent.click(screen.getByLabelText('Submit question'));
    const canvas = screen.getByLabelText('Agent reasoning canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 10, top: 20, width: 1000, height: 700, right: 1010, bottom: 720, x: 10, y: 20, toJSON: () => ({}) }),
    });

    fireEvent.wheel(canvas, { deltaY: -16, clientX: 410, clientY: 320, ctrlKey: true });
    const transform = (container.querySelector('.canvas-world') as HTMLElement).style.transform;
    const values = transform.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const [x, y, scale] = values;
    const worldX = 400 - 90;
    const worldY = 300 - 30;

    expect(scale).toBeCloseTo(1.08);
    expect(x + worldX * scale).toBeCloseTo(400);
    expect(y + worldY * scale).toBeCloseTo(300);
  });

  it('allows zooming out to a full-canvas view', () => {
    const { container } = render(<App />);
    fireEvent.change(screen.getByLabelText('Question input'), { target: { value: 'Test full canvas view' } });
    fireEvent.click(screen.getByLabelText('Submit question'));
    const canvas = screen.getByLabelText('Agent reasoning canvas');

    for (let index = 0; index < 10; index += 1) {
      fireEvent.wheel(canvas, { deltaY: 100, clientX: 400, clientY: 300, ctrlKey: true });
    }

    const transform = (container.querySelector('.canvas-world') as HTMLElement).style.transform;
    const values = transform.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    expect(values[2]).toBeCloseTo(0.25);
  });

  it('pans without zooming on a two-finger trackpad gesture', () => {
    const { container } = render(<App />);
    fireEvent.change(screen.getByLabelText('Question input'), { target: { value: 'Test trackpad panning' } });
    fireEvent.click(screen.getByLabelText('Submit question'));
    const canvas = screen.getByLabelText('Agent reasoning canvas');

    fireEvent.wheel(canvas, { deltaX: 24, deltaY: 36, deltaMode: 0 });
    const transform = (container.querySelector('.canvas-world') as HTMLElement).style.transform;
    const values = transform.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];

    expect(values[0]).toBeCloseTo(66);
    expect(values[1]).toBeCloseTo(-6);
    expect(values[2]).toBeCloseTo(1);
  });

  it('leaves wheel scrolling to the JSON document under the pointer', async () => {
    const { container } = render(<App />);
    fireEvent.change(screen.getByLabelText('Question input'), { target: { value: 'Test JSON scrolling' } });
    fireEvent.click(screen.getByLabelText('Submit question'));
    await finishAnalysis();
    fireEvent.click(screen.getByLabelText('Open raw JSON for node 1'));

    const jsonDocument = screen.getByLabelText('Raw JSON document for node 1');
    const world = container.querySelector('.canvas-world') as HTMLElement;
    const transformBefore = world.style.transform;
    const wheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 80,
    });

    jsonDocument.dispatchEvent(wheelEvent);

    expect(wheelEvent.defaultPrevented).toBe(false);
    expect(world.style.transform).toBe(transformBefore);

    const zoomEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      clientX: 240,
      clientY: 180,
      deltaY: -20,
    });

    act(() => {
      jsonDocument.dispatchEvent(zoomEvent);
    });

    expect(zoomEvent.defaultPrevented).toBe(true);
    expect(world.style.transform).not.toBe(transformBefore);
  });
});
