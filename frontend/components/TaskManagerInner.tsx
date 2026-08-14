/**
 * TaskManagerInner.tsx
 * The core task list + add form, usable standalone or embedded in any panel.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../src/authContext';
import { getTasks, createTask, updateTask, deleteTask, getTaskSummary, Task } from '../src/api';

const PRIORITY_META: Record<string, { label: string; color: string; bg: string }> = {
  high:   { label: 'High', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  medium: { label: 'Med',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  low:    { label: 'Low',  color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
};
const STATUS_META: Record<string, { label: string; color: string; next: string }> = {
  todo:        { label: 'To Do',       color: 'var(--text-muted)',  next: 'in_progress' },
  in_progress: { label: 'In Progress', color: 'var(--accent-cyan)', next: 'done' },
  done:        { label: 'Done',        color: 'var(--success)',     next: 'todo' },
};

function speakSummary(text: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find(v => v.lang.startsWith('en-US') && /zira|aria|jenny|michelle|samantha/i.test(v.name))
    ?? voices.find(v => v.lang.startsWith('en-US')) ?? voices[0] ?? null;
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.lang = 'en-US'; u.rate = 0.95;
  window.speechSynthesis.speak(u);
}

export default function TaskManagerInner() {
  const { accessToken } = useAuth();
  const [tasks, setTasks]       = useState<Task[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [summary, setSummary]   = useState<{ total: number; done: number; in_progress: number; todo: number } | null>(null);
  const [newTitle, setNewTitle]     = useState('');
  const [newDesc, setNewDesc]       = useState('');
  const [newPriority, setNewPriority] = useState<'low'|'medium'|'high'>('medium');
  const [newDue, setNewDue]         = useState('');

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [t, s] = await Promise.all([getTasks(accessToken), getTaskSummary(accessToken)]);
      setTasks(t); setSummary(s);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !accessToken) return;
    await createTask(accessToken, { title: newTitle, description: newDesc, priority: newPriority, due_date: newDue || null, status: 'todo' });
    setNewTitle(''); setNewDesc(''); setNewDue(''); setNewPriority('medium'); setShowAdd(false);
    load();
  };

  const handleCycleStatus = async (task: Task) => {
    if (!accessToken) return;
    const next = STATUS_META[task.status]?.next ?? 'todo';
    await updateTask(accessToken, task.id, { status: next as any });
    load();
  };

  const handleDelete = async (id: string) => {
    if (!accessToken) return;
    await deleteTask(accessToken, id);
    load();
  };

  const handleVoice = async () => {
    if (!accessToken) return;
    setSpeaking(true);
    try {
      const s = await getTaskSummary(accessToken);
      speakSummary(s.summary);
      setTimeout(() => setSpeaking(false), 4000);
    } catch { setSpeaking(false); }
  };

  const done = tasks.filter(t => t.status === 'done').length;
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Stats */}
      {tasks.length > 0 && (
        <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Overall Progress</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--accent-light)', fontWeight: '600' }}>{progress}%</span>
              <button onClick={handleVoice}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem',
                  color: speaking ? 'var(--success)' : 'var(--text-muted)',
                  animation: speaking ? 'pulsing 1s ease-in-out infinite' : 'none',
                }}>
                {speaking ? '🔊' : '🔈'}
              </button>
            </div>
          </div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.6rem' }}>
            {[
              { label: 'Total', val: summary?.total ?? 0, color: 'var(--accent-light)' },
              { label: 'Done',  val: summary?.done ?? 0,  color: 'var(--success)' },
              { label: 'Active',val: summary?.in_progress ?? 0, color: 'var(--accent-cyan)' },
              { label: 'Todo',  val: summary?.todo ?? 0,  color: 'var(--warning)' },
            ].map(s => (
              <div key={s.label} style={{ flex: 1, textAlign: 'center', padding: '0.35rem', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.9rem', fontWeight: '700', color: s.color, fontFamily: 'var(--font-mono)' }}>{s.val}</div>
                <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Task list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.65rem' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }} className="pulsing">Loading...</div>
        ) : tasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2rem', opacity: 0.3, marginBottom: '0.5rem' }}>✅</div>
            <p style={{ fontSize: '0.8rem' }}>No tasks yet</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {tasks.map(task => {
              const pMeta = PRIORITY_META[task.priority] ?? PRIORITY_META.medium;
              const sMeta = STATUS_META[task.status] ?? STATUS_META.todo;
              return (
                <div key={task.id} className="card-3d" style={{ borderRadius: 'var(--r-md)', padding: '0.75rem', animation: 'fadeUp 0.2s var(--ease)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                    <button onClick={() => handleCycleStatus(task)}
                      style={{
                        width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0, marginTop: '2px',
                        background: task.status === 'done' ? 'var(--success)' : task.status === 'in_progress' ? 'var(--accent-cyan)' : 'transparent',
                        border: `2px solid ${sMeta.color}`, cursor: 'pointer', transition: 'all var(--dur-fast)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.55rem',
                      }}>
                      {task.status === 'done' ? '✓' : ''}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.2rem' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: '500', color: task.status === 'done' ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: task.status === 'done' ? 'line-through' : 'none', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {task.title}
                        </span>
                        <span style={{ fontSize: '0.6rem', fontWeight: '600', padding: '1px 5px', borderRadius: '999px', background: pMeta.bg, color: pMeta.color, flexShrink: 0 }}>
                          {pMeta.label}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ fontSize: '0.65rem', color: sMeta.color }}>{sMeta.label}</span>
                        {task.due_date && <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>· 📅 {task.due_date}</span>}
                        <div style={{ flex: 1 }} />
                        <button onClick={() => handleDelete(task.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.7rem', padding: '2px', transition: 'color var(--dur-fast)' }}
                          onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>✕</button>
                      </div>
                      {task.status !== 'todo' && (
                        <div className="progress-track" style={{ marginTop: '0.4rem' }}>
                          <div className="progress-fill" style={{ width: `${task.progress}%` }} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add task */}
      <div style={{ padding: '0.65rem', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        {showAdd ? (
          <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', animation: 'fadeUp 0.15s var(--ease)' }}>
            <input autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Task title..." className="input-glass" style={{ padding: '0.55rem 0.8rem', fontSize: '0.83rem', width: '100%' }} />
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Description (optional)" className="input-glass" style={{ padding: '0.55rem 0.8rem', fontSize: '0.8rem', width: '100%' }} />
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <select value={newPriority} onChange={e => setNewPriority(e.target.value as any)} className="input-glass" style={{ flex: 1, padding: '0.5rem 0.6rem', fontSize: '0.8rem', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <input type="date" value={newDue} onChange={e => setNewDue(e.target.value)} className="input-glass" style={{ flex: 1, padding: '0.5rem 0.6rem', fontSize: '0.8rem', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }} />
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button type="submit" className="btn-primary" style={{ flex: 1, padding: '0.55rem', fontSize: '0.82rem', fontWeight: '600' }}>Add Task</button>
              <button type="button" className="btn-ghost" onClick={() => setShowAdd(false)} style={{ padding: '0.55rem 0.9rem', fontSize: '0.82rem' }}>Cancel</button>
            </div>
          </form>
        ) : (
          <button onClick={() => setShowAdd(true)} className="btn-primary" style={{ width: '100%', padding: '0.65rem', fontSize: '0.83rem', fontWeight: '600', borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
            <span>+</span> Add Task
          </button>
        )}
      </div>
    </div>
  );
}
