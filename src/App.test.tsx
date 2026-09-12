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

  it('允许用户收起和重新展开 Benchmark，同时保留运行状态', async () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: '收起 Benchmark' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('输入问题'), { target: { value: '测试 Benchmark 折叠' } });
    fireEvent.click(screen.getByLabelText('提交问题'));

    const collapseButton = screen.getByRole('button', { name: '收起 Benchmark' });
    const details = screen.getByRole('region', { name: 'Agent Benchmark 详情' });
    expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
    expect(details).not.toHaveAttribute('hidden');

    fireEvent.click(collapseButton);
    expect(screen.getByRole('button', { name: '展开 Benchmark' })).toHaveAttribute('aria-expanded', 'false');
    expect(details).toHaveAttribute('hidden');
    expect(screen.getByText('EVALUATING')).toBeInTheDocument();

    await finishAnalysis();
    expect(details).toHaveAttribute('hidden');
    expect(screen.getByText('WINNER SELECTED')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '展开 Benchmark' }));
    expect(screen.getByRole('button', { name: '收起 Benchmark' })).toHaveAttribute('aria-expanded', 'true');
    expect(details).not.toHaveAttribute('hidden');
  });

  it('提交新的追问时会重新展开 Benchmark', async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('输入问题'), { target: { value: '第一轮问题' } });
    fireEvent.click(screen.getByLabelText('提交问题'));
    await finishAnalysis();
    fireEvent.click(screen.getByRole('button', { name: '收起 Benchmark' }));

    fireEvent.change(screen.getByLabelText('输入问题'), { target: { value: '继续追问' } });
    fireEvent.click(screen.getByLabelText('提交问题'));

    expect(screen.getByRole('button', { name: '收起 Benchmark' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Agent Benchmark 详情' })).not.toHaveAttribute('hidden');
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
    const { container } = render(<App />);
    fireEvent.change(screen.getByLabelText('输入问题'), { target: { value: '制定第一版方案' } });
    fireEvent.click(screen.getByLabelText('提交问题'));
    await finishAnalysis();
    fireEvent.change(screen.getByLabelText('输入问题'), { target: { value: '如果时间只有一天呢？' } });
    fireEvent.click(screen.getByLabelText('提交问题'));
    expect(container.querySelectorAll('.node-stack')).toHaveLength(2);
    expect(screen.getByText('FOLLOW-UP SYNTHESIS')).toBeInTheDocument();
    await finishAnalysis();
    expect(screen.getAllByText('SYNTHESIS COMPLETE')).toHaveLength(2);
  });

  it('始终按节点编号顺序连接箭头', async () => {
    const { container } = render(<App />);

    for (const question of ['节点一', '节点二']) {
      fireEvent.change(screen.getByLabelText('输入问题'), { target: { value: question } });
      fireEvent.click(screen.getByLabelText('提交问题'));
      await finishAnalysis();
    }

    fireEvent.click(container.querySelectorAll<HTMLElement>('.node-stack')[0]);
    fireEvent.change(screen.getByLabelText('输入问题'), { target: { value: '节点三' } });
    fireEvent.click(screen.getByLabelText('提交问题'));

    const paths = container.querySelectorAll<SVGPathElement>('.connections > path');
    expect(paths).toHaveLength(2);
    expect(paths[0].getAttribute('d')).toMatch(/^M 550 361/);
    expect(paths[1].getAttribute('d')).toMatch(/^M 1100 361/);
  });

  it('拖动选中节点时会更新位置并保持连接线同步', async () => {
    const { container } = render(<App />);
    fireEvent.change(screen.getByLabelText('输入问题'), { target: { value: '创建父节点' } });
    fireEvent.click(screen.getByLabelText('提交问题'));
    await finishAnalysis();
    fireEvent.change(screen.getByLabelText('输入问题'), { target: { value: '创建子节点' } });
    fireEvent.click(screen.getByLabelText('提交问题'));

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

  it('允许缩小到更远的全画布视角', () => {
    const { container } = render(<App />);
    fireEvent.change(screen.getByLabelText('输入问题'), { target: { value: '测试全画布视角' } });
    fireEvent.click(screen.getByLabelText('提交问题'));
    const canvas = screen.getByLabelText('Agent 思考路径画布');

    for (let index = 0; index < 10; index += 1) {
      fireEvent.wheel(canvas, { deltaY: 100, clientX: 400, clientY: 300, ctrlKey: true });
    }

    const transform = (container.querySelector('.canvas-world') as HTMLElement).style.transform;
    const values = transform.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    expect(values[2]).toBeCloseTo(0.25);
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
