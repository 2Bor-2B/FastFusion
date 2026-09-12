import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

/** Runs the mock backend's timers to completion. */
async function finishRun() {
  await act(async () => { await vi.runAllTimersAsync(); });
}

async function ask(question: string) {
  fireEvent.change(screen.getByLabelText('Your prompt'), { target: { value: question } });
  fireEvent.click(screen.getByLabelText('Submit prompt'));
}

const openPanel = () => screen.queryByRole('button', { name: /Hide activity/ });

describe('FastFusion thinking canvas', () => {
  beforeEach(() => {
    // The canvas autosaves, so each test must start from an empty one.
    localStorage.clear();
    vi.useFakeTimers();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:skills') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  afterEach(() => vi.useRealTimers());

  it('opens with only the command bar, then reveals the canvas chrome', async () => {
    render(<App />);
    expect(screen.getByLabelText('Your prompt')).toHaveAttribute('placeholder', 'Write a message...');
    expect(screen.queryByText('fastfusion')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Canvas zoom')).not.toBeInTheDocument();
    // Only Load stays reachable on an empty canvas.
    expect(screen.getByLabelText('Load canvas')).toBeInTheDocument();
    expect(screen.queryByLabelText('Save canvas')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Clear canvas')).not.toBeInTheDocument();

    await ask('Design an AI thinking canvas');

    expect(screen.getByText('fastfusion')).toBeInTheDocument();
    expect(screen.getByLabelText('Canvas zoom')).toBeInTheDocument();
    expect(screen.getByLabelText('Clear canvas')).toBeInTheDocument();
    expect(screen.getByLabelText('Save canvas')).toBeInTheDocument();
    expect(screen.getByLabelText('Load canvas')).toBeInTheDocument();
    expect(screen.getByText('Untitled canvas')).toBeInTheDocument();
    // The stage label also appears in the screen-reader live region.
    expect(screen.getAllByText('Exploring in parallel').length).toBeGreaterThan(0);
  });

  it('runs every model, ranks them, and renders the synthesis', async () => {
    const { container } = render(<App />);
    await ask('Design an AI thinking canvas');

    expect(screen.getByLabelText('Stop exploration')).toBeInTheDocument();
    await finishRun();

    expect(screen.getAllByText('Exploration complete').length).toBeGreaterThan(0);
    expect(screen.getByText('Selected response')).toBeInTheDocument();
    expect(screen.getByText('让系统替模型兜底')).toBeInTheDocument();
    expect(container.querySelectorAll('.answer-points li')).toHaveLength(3);

    // The winner and its score are named in the block footer.
    const footer = container.querySelector('.node-footer') as HTMLElement;
    expect(within(footer).getByText('Nex Mini')).toBeInTheDocument();
    expect(within(footer).getByText('92')).toBeInTheDocument();
    expect(screen.getByLabelText('Submit prompt')).toBeInTheDocument();
  });

  it('shows each model in the activity panel and marks the top score', async () => {
    render(<App />);
    await ask('Design an AI thinking canvas');
    await finishRun();

    fireEvent.click(screen.getByRole('button', { name: /View activity/ }));
    expect(screen.getByText('Model workspace')).toBeInTheDocument();

    const workspace = document.getElementById('agent-workspace')!;
    const cards = workspace.querySelectorAll('.agent-card');
    expect(cards).toHaveLength(3);
    expect(within(cards[0] as HTMLElement).getByText('Top score')).toBeInTheDocument();
    expect(within(cards[0] as HTMLElement).getByText('Nex Mini')).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByText('Evaluated')).toBeInTheDocument();
    expect(screen.getByText('Synthesis')).toBeInTheDocument();
  });

  it('collapses and reopens the activity panel', async () => {
    render(<App />);
    await ask('Design an AI thinking canvas');
    expect(openPanel()).toBeInTheDocument();

    const workspace = document.getElementById('agent-workspace')!;
    const reveal = workspace.parentElement!;
    expect(reveal).toHaveClass('open');
    expect(workspace).toHaveAttribute('aria-hidden', 'false');

    fireEvent.click(screen.getByRole('button', { name: /Hide activity/ }));
    expect(reveal).not.toHaveClass('open');
    expect(workspace).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(screen.getByRole('button', { name: /View activity/ }));
    expect(reveal).toHaveClass('open');
    expect(workspace).toHaveAttribute('aria-hidden', 'false');
  });

  it('slides the raw payload sheet over the card and back', async () => {
    const { container } = render(<App />);
    await ask('Design an AI thinking canvas');
    await finishRun();

    const stack = container.querySelector('.node-stack')!;
    expect(stack).not.toHaveClass('raw-expanded');
    expect(screen.getByLabelText('Open raw response')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Open raw response'));
    expect(stack).toHaveClass('raw-expanded');
    expect(screen.getByText('Prompt')).toBeInTheDocument();
    expect(screen.getByText('Payload')).toBeInTheDocument();
    expect(screen.getByText('Design an AI thinking canvas')).toBeInTheDocument();
    expect(screen.getByLabelText('Block 1 raw JSON').textContent).toContain('selected_agent');

    fireEvent.click(screen.getByLabelText('Close raw response'));
    expect(stack).not.toHaveClass('raw-expanded');
    expect(screen.queryByText('Payload')).not.toBeInTheDocument();
  });

  it('branches a follow-up from the selected node and connects the two', async () => {
    const { container } = render(<App />);
    await ask('Design an AI thinking canvas');
    await finishRun();

    expect(screen.getByRole('button', { name: /Continue from 01/ })).toBeInTheDocument();
    await ask('What if I only had one day?');
    await finishRun();

    expect(container.querySelectorAll('.node-stack')).toHaveLength(2);
    expect(container.querySelectorAll('.connections path[marker-end]')).toHaveLength(1);
    expect(screen.getByText('Block 1')).toBeInTheDocument();
    expect(screen.getByText('Block 2')).toBeInTheDocument();
  });

  it('exports the ticked nodes as Markdown', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<App />);
    await ask('Design an AI thinking canvas');
    await finishRun();

    expect(screen.queryByRole('button', { name: /Export Skills/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Add block 1 to the export'));

    const exportButton = screen.getByRole('button', { name: /Export Skills/ });
    expect(exportButton.textContent).toContain('1');
    fireEvent.click(exportButton);

    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toContain('Exported 1 block');

    const blob = (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blob.type).toBe('text/markdown;charset=utf-8');

    fireEvent.click(screen.getByLabelText('Remove block 1 from the export'));
    expect(screen.queryByRole('button', { name: /Export Skills/ })).not.toBeInTheDocument();
    anchorClick.mockRestore();
  });

  it('zooms with the controls and reports the level', async () => {
    render(<App />);
    await ask('Design an AI thinking canvas');
    await finishRun();

    const controls = screen.getByLabelText('Canvas zoom');
    const level = () => Number(within(controls).getByText(/%$/).textContent!.replace('%', ''));
    const before = level();

    fireEvent.click(screen.getByLabelText('Zoom out'));
    expect(level()).toBeLessThan(before);

    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(level()).toBe(before);
  });

  it('pans the canvas when the background is dragged', async () => {
    const { container } = render(<App />);
    await ask('Design an AI thinking canvas');
    await finishRun();

    const surface = screen.getByLabelText(/Thinking canvas/);
    const world = container.querySelector('.canvas-world') as HTMLElement;
    const before = world.style.transform;

    fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 460, clientY: 340 });
    expect(world.style.transform).not.toBe(before);
    fireEvent.pointerUp(surface, { pointerId: 1 });
  });

  it('drags a node by its header and keeps the connection attached', async () => {
    const { container } = render(<App />);
    await ask('First');
    await finishRun();
    await ask('Second');
    await finishRun();

    const header = container.querySelectorAll('.node-header')[1] as HTMLElement;
    const path = container.querySelector('.connections path[marker-end]') as SVGPathElement;
    const before = path.getAttribute('d');

    fireEvent.pointerDown(header, { button: 0, pointerId: 3, clientX: 500, clientY: 300 });
    fireEvent.pointerMove(header, { pointerId: 3, clientX: 560, clientY: 360 });
    expect(path.getAttribute('d')).not.toBe(before);
    fireEvent.pointerUp(header, { pointerId: 3 });
  });

  it('restores the canvas after a reload, and clearing forgets it', async () => {
    const first = render(<App />);
    await ask('Design an AI thinking canvas');
    await finishRun();
    first.unmount();

    // A remount stands in for the page reload.
    const second = render(<App />);
    expect(second.container.querySelectorAll('.node-stack')).toHaveLength(1);
    expect(screen.getByText('Block 1')).toBeInTheDocument();
    expect(screen.getByText('让系统替模型兜底')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Clear canvas'));
    second.unmount();

    const third = render(<App />);
    expect(third.container.querySelectorAll('.node-stack')).toHaveLength(0);
  });

  it('renames the canvas on double-click and uses the name as the filename', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<App />);
    await ask('Design an AI thinking canvas');
    await finishRun();

    fireEvent.doubleClick(screen.getByText('Untitled canvas'));
    const field = screen.getByLabelText('Canvas name');
    fireEvent.change(field, { target: { value: '  Reliability   study  ' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(screen.queryByLabelText('Canvas name')).not.toBeInTheDocument();
    expect(screen.getByText('Reliability study')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Save canvas'));
    const link = anchorClick.mock.instances[0] as HTMLAnchorElement;
    expect(link.download).toBe('Reliability study.json');
    anchorClick.mockRestore();
  });

  it('discards a rename on Escape and falls back to the default when emptied', async () => {
    render(<App />);
    await ask('Design an AI thinking canvas');
    await finishRun();

    fireEvent.doubleClick(screen.getByText('Untitled canvas'));
    fireEvent.change(screen.getByLabelText('Canvas name'), { target: { value: 'thrown away' } });
    fireEvent.keyDown(screen.getByLabelText('Canvas name'), { key: 'Escape' });
    expect(screen.getByText('Untitled canvas')).toBeInTheDocument();

    fireEvent.doubleClick(screen.getByText('Untitled canvas'));
    fireEvent.change(screen.getByLabelText('Canvas name'), { target: { value: '   ' } });
    fireEvent.blur(screen.getByLabelText('Canvas name'));
    expect(screen.getByText('Untitled canvas')).toBeInTheDocument();
  });

  it('shows skeleton bars for a model that has not answered yet', async () => {
    render(<App />);
    await ask('Design an AI thinking canvas');

    const workspace = document.getElementById('agent-workspace')!;
    expect(workspace.querySelectorAll('.agent-skeleton')).toHaveLength(3);

    await finishRun();
    expect(workspace.querySelectorAll('.agent-skeleton')).toHaveLength(0);
  });

  it('saves the canvas to a file', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<App />);
    await ask('Design an AI thinking canvas');
    await finishRun();

    fireEvent.click(screen.getByLabelText('Save canvas'));
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toContain('Saved 1 block');

    const blob = (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/json');
    anchorClick.mockRestore();
  });

  it('clears the canvas back to the empty state', async () => {
    render(<App />);
    await ask('Design an AI thinking canvas');
    await finishRun();

    fireEvent.click(screen.getByLabelText('Clear canvas'));
    expect(screen.queryByText('fastfusion')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Your prompt')).toHaveAttribute('placeholder', 'Write a message...');
  });

  it('submits on Enter but not on Shift+Enter or during IME composition', async () => {
    const { container } = render(<App />);
    const input = screen.getByLabelText('Your prompt');

    fireEvent.change(input, { target: { value: '不要提交' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(container.querySelectorAll('.node-stack')).toHaveLength(0);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(container.querySelectorAll('.node-stack')).toHaveLength(1);
  });
});
