import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import Home from './page';

describe('拾光清单', () => {
  it('添加新待办并自动选中', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await user.type(screen.getByLabelText('添加新的待办事项'), '准备演示材料');
    await user.click(screen.getByRole('button', { name: '添加' }));
    expect(screen.getByDisplayValue('准备演示材料')).toBeInTheDocument();
    expect(screen.getByText('5 项')).toBeInTheDocument();
  });

  it('按标题和详细内容搜索待办', async () => {
    const user = userEvent.setup();
    render(<Home />);
    const search = screen.getByLabelText('搜索待办');
    await user.type(search, '邮件');
    expect(screen.getByRole('button', { name: /回复客户邮件/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /整理本周项目计划/ })).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, '移动端流程');
    expect(screen.getByRole('button', { name: /完成设计稿评审/ })).toBeInTheDocument();
  });

  it('直接编辑待办标题和详情', async () => {
    const user = userEvent.setup();
    render(<Home />);
    const title = screen.getByLabelText('待办标题');
    await user.clear(title);
    await user.type(title, '更新后的项目计划');
    expect(screen.getByRole('button', { name: /更新后的项目计划/ })).toBeInTheDocument();
    const description = screen.getByLabelText('详细内容');
    await user.clear(description);
    await user.type(description, '新的详细内容');
    expect(description).toHaveValue('新的详细内容');
  });

  it('完成并删除当前待办', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await user.click(screen.getByRole('button', { name: '标记为完成' }));
    expect(screen.getByText('已完成')).toBeInTheDocument();
    const app = screen.getByLabelText('待办事项管理器');
    await user.click(within(app).getByRole('button', { name: /删除/ }));
    expect(screen.queryByDisplayValue('整理本周项目计划')).not.toBeInTheDocument();
    expect(screen.getByText('3 项')).toBeInTheDocument();
  });
});
