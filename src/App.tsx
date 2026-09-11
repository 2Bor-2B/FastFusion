'use client';

import { useMemo, useState } from 'react';
import { Check, CheckCircle2, Circle, Clock3, ListTodo, MoreHorizontal, Plus, Search, Sparkles, Trash2 } from 'lucide-react';

type Todo = { id: number; title: string; description: string; completed: boolean; createdAt: string };

const initialTodos: Todo[] = [
  { id: 1, title: '整理本周项目计划', description: '梳理本周的重点任务，确认里程碑与负责人。\n\n需要重点关注：\n• 完成产品原型评审\n• 同步开发排期\n• 准备周五的项目复盘', completed: false, createdAt: '今天，09:30' },
  { id: 2, title: '回复客户邮件', description: '确认下周会议时间，并附上更新后的方案文档。', completed: false, createdAt: '今天，08:45' },
  { id: 3, title: '完成设计稿评审', description: '检查首页和移动端流程，整理反馈并发给设计团队。', completed: true, createdAt: '昨天，16:20' },
  { id: 4, title: '预约年度体检', description: '联系医院预约下周三上午的年度体检。', completed: false, createdAt: '昨天，11:05' },
];

export default function Home() {
  const [todos, setTodos] = useState(initialTodos);
  const [selectedId, setSelectedId] = useState(initialTodos[0].id);
  const [query, setQuery] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const filteredTodos = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-CN');
    return keyword ? todos.filter((todo) => `${todo.title} ${todo.description}`.toLocaleLowerCase('zh-CN').includes(keyword)) : todos;
  }, [query, todos]);
  const selectedTodo = todos.find((todo) => todo.id === selectedId) ?? null;
  const completedCount = todos.filter((todo) => todo.completed).length;

  function addTodo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    const nextTodo: Todo = { id: Date.now(), title, description: '', completed: false, createdAt: '刚刚' };
    setTodos((current) => [nextTodo, ...current]); setSelectedId(nextTodo.id); setNewTitle(''); setQuery('');
  }
  function updateSelected(patch: Partial<Todo>) { setTodos((current) => current.map((todo) => todo.id === selectedId ? { ...todo, ...patch } : todo)); }
  function deleteSelected() {
    if (!selectedTodo) return;
    const remaining = todos.filter((todo) => todo.id !== selectedTodo.id);
    setTodos(remaining); setSelectedId(remaining[0]?.id ?? 0);
  }

  return <main className="app-shell">
    <section className="todo-app" aria-label="待办事项管理器">
      <aside className="sidebar">
        <header className="brand-row"><div className="brand-mark"><Check aria-hidden="true" /></div><div><h1>拾光清单</h1><p>把重要的事，一件件完成</p></div></header>
        <form className="add-form" onSubmit={addTodo}><Plus aria-hidden="true" /><input aria-label="添加新的待办事项" placeholder="添加一个新待办…" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} /><button type="submit">添加</button></form>
        <label className="search-box"><Search aria-hidden="true" /><input aria-label="搜索待办" type="search" placeholder="搜索待办内容" value={query} onChange={(e) => setQuery(e.target.value)} />{query && <span>{filteredTodos.length}</span>}</label>
        <div className="list-heading"><span>我的待办</span><span>{todos.length} 项</span></div>
        <div className="todo-list">
          {filteredTodos.map((todo) => <button type="button" className={`todo-row ${selectedId === todo.id ? 'active' : ''}`} key={todo.id} onClick={() => setSelectedId(todo.id)}>
            {todo.completed ? <CheckCircle2 className="status done" /> : <Circle className="status" />}<span className="todo-copy"><strong className={todo.completed ? 'completed' : ''}>{todo.title}</strong><small>{todo.description || '暂无详细说明'}</small></span><span className="row-time">{todo.createdAt.split('，')[0]}</span>
          </button>)}
          {filteredTodos.length === 0 && <div className="empty-list"><Search aria-hidden="true" /><p>没有找到相关待办</p><button type="button" onClick={() => setQuery('')}>清除搜索</button></div>}
        </div>
        <footer className="progress-card"><div><Sparkles aria-hidden="true" /><span>今日进度</span><strong>{completedCount}/{todos.length}</strong></div><div className="progress-track"><span style={{ width: `${todos.length ? (completedCount / todos.length) * 100 : 0}%` }} /></div><p>{todos.length - completedCount > 0 ? `还有 ${todos.length - completedCount} 件事，慢慢来。` : '今天的任务全部完成了！'}</p></footer>
      </aside>
      <section className="detail-pane">
        {selectedTodo ? <>
          <header className="detail-toolbar"><div className="detail-status"><span className={selectedTodo.completed ? 'done-dot' : ''} />{selectedTodo.completed ? '已完成' : '进行中'}</div><div className="toolbar-actions"><button type="button" aria-label="更多操作"><MoreHorizontal /></button><button type="button" className="delete-button" onClick={deleteSelected}><Trash2 />删除</button></div></header>
          <div className="editor"><label className="sr-only" htmlFor="todo-title">待办标题</label><input id="todo-title" className="title-input" value={selectedTodo.title} onChange={(e) => updateSelected({ title: e.target.value })} /><div className="meta-row"><Clock3 />创建于 {selectedTodo.createdAt}</div><div className="divider" /><label htmlFor="todo-description">详细内容</label><textarea id="todo-description" placeholder="写下这件事的具体内容…" value={selectedTodo.description} onChange={(e) => updateSelected({ description: e.target.value })} /><div className="editor-note"><span /> 所有修改已自动保存</div></div>
          <footer className="detail-footer"><button type="button" className={`complete-button ${selectedTodo.completed ? 'is-complete' : ''}`} onClick={() => updateSelected({ completed: !selectedTodo.completed })}>{selectedTodo.completed ? <><Circle />标记为未完成</> : <><Check />标记为完成</>}</button></footer>
        </> : <div className="empty-detail"><ListTodo /><h2>选择一个待办</h2><p>从左侧列表选择，或添加一个新待办开始记录。</p></div>}
      </section>
    </section>
  </main>;
}
