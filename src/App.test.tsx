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
});
