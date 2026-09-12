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
  });

  afterEach(() => vi.useRealTimers());

  it('从命令栏提交问题并完成 Agent 评分与总结', async () => {
    render(<App />);
    expect(screen.queryByText('LIVE BENCHMARK')).not.toBeInTheDocument();
    const input = screen.getByLabelText('输入问题');
    fireEvent.change(input, { target: { value: '怎样设计一个可靠的 AI Agent？' } });
    fireEvent.click(screen.getByLabelText('提交问题'));
    expect(screen.getByText('LIVE BENCHMARK')).toBeInTheDocument();
    expect(screen.getByText('COMPARING AGENTS')).toBeInTheDocument();
    await finishAnalysis();
    expect(screen.getByText('WINNER')).toBeInTheDocument();
    expect(screen.getByText('SYNTHESIS COMPLETE')).toBeInTheDocument();
    expect(screen.getAllByText('92', { exact: true })).toHaveLength(2);
  });

  it('展开原始 JSON、选择节点并导出 Markdown Skills', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<App />);
    fireEvent.change(screen.getByLabelText('输入问题'), { target: { value: '优化团队协作流程' } });
    fireEvent.click(screen.getByLabelText('提交问题'));
    await finishAnalysis();
    fireEvent.click(screen.getByLabelText('展开原始 JSON'));
    expect(screen.getByText('PAYLOAD')).toBeInTheDocument();
    expect(screen.getByText(/selected_agent/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('选择节点 1'));
    expect(screen.getByRole('button', { name: 'Export Skills' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export Skills' }));
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(anchorClick).toHaveBeenCalledOnce();
    anchorClick.mockRestore();
  });

  it('连续追问会在画布中保留原节点并创建连接节点', async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('输入问题'), { target: { value: '制定第一版方案' } });
    fireEvent.click(screen.getByLabelText('提交问题'));
    await finishAnalysis();
    fireEvent.change(screen.getByLabelText('输入问题'), { target: { value: '如果时间只有一天呢？' } });
    fireEvent.click(screen.getByLabelText('提交问题'));
    expect(screen.getByText('02 TRACES')).toBeInTheDocument();
    expect(screen.getByText('FOLLOW-UP SYNTHESIS')).toBeInTheDocument();
    await finishAnalysis();
    expect(screen.getAllByText('SYNTHESIS COMPLETE')).toHaveLength(2);
  });

  it('滚轮缩放时保持鼠标下方的世界坐标不移动', () => {
    const { container } = render(<App />);
    fireEvent.change(screen.getByLabelText('输入问题'), { target: { value: '测试缩放锚点' } });
    fireEvent.click(screen.getByLabelText('提交问题'));
    const canvas = screen.getByLabelText('Agent 思考路径画布');
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

  it('触控板双指滑动只平移画布而不改变缩放比例', () => {
    const { container } = render(<App />);
    fireEvent.change(screen.getByLabelText('输入问题'), { target: { value: '测试触控板平移' } });
    fireEvent.click(screen.getByLabelText('提交问题'));
    const canvas = screen.getByLabelText('Agent 思考路径画布');

    fireEvent.wheel(canvas, { deltaX: 24, deltaY: 36, deltaMode: 0 });
    const transform = (container.querySelector('.canvas-world') as HTMLElement).style.transform;
    const values = transform.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];

    expect(values[0]).toBeCloseTo(66);
    expect(values[1]).toBeCloseTo(-6);
    expect(values[2]).toBeCloseTo(1);
  });

  it('鼠标悬停 JSON 文档时滚轮交给文档自身而不平移画布', async () => {
    const { container } = render(<App />);
    fireEvent.change(screen.getByLabelText('输入问题'), { target: { value: '测试 JSON 文档滚动' } });
    fireEvent.click(screen.getByLabelText('提交问题'));
    await finishAnalysis();
    fireEvent.click(screen.getByLabelText('展开原始 JSON'));

    const jsonDocument = screen.getByLabelText('节点 1 原始 JSON 文档');
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
