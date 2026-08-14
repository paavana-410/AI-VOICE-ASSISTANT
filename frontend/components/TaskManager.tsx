/**
 * TaskManager.tsx — Slide-in task panel with progress bars and voice summary
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../src/authContext';
import { getTasks, createTask, updateTask, deleteTask, getTaskSummary, Task } from '../src/api';

const PRIORITY_META: Record<string, { label: string; color: string; bg: string }> = {
  high:   { label: 'High',   color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  medium: { label: 'Med',    color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  low:    { label: 'Low',    color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
};

const STATUS_META: Record<string, { label: string; color: string; next: string }> = {
  todo:        { label: 'To Do',       color: 'var(--text-muted)',    next: 'in_progress' },
  in_progress: { label: 'In Progress', color: 'var(--accent-cyan)',   next: 'done' },
  done:        { label: 'Done',        color: 'var(--success)',       next: 'todo' },
};

function speakSummary(text: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find(v => v.lang.startsWith('en-US') && /zira|aria|jenny|michelle|samantha/i.test(v.name))
    ?? voices.find(v => v.lang.startsWith('en-US'))
    ?? voices[0] ?? null;
  const utter = new SpeechSynthesisUtterance(text);
  if (voice) utter.voice = voice;
  utter.lang = 'en-US';
  utter.rate = 0.95;
  utter.pitch = 1.0;
  window.speechSynthesis.speak(utter);
}

interface Props { onClose: () => void; }

export default function TaskManager({ onClose }: Props) {
  const { accessToken } = useAuth();
  const [tasks, setTasks]           = useState<Task[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showAdd, setShowAdd]       = useState(false);
  const [speaking, setSpeaking]     = useState(false);
  const [summary, setSummary]       = useState<{ total:number; done:number; in_progress:number; todo:number } | null>(null);

  const [newTitle, setNewTitle]     = useState('');
  const [newDesc, setNewDesc]       = useState('');
  const [newPriority, setNewPriority] = useState<'low'|'medium'|'high'>('medium');
  const [newDue, setNewDue]         = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [t, s] = await Promise.all([getTasks(accessToken), getTaskSummary(accessToken)]);
      setTasks(t);
      setSummary(s);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  // Close on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => document.addEventListener('mousedown', h), 100);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

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

  const handleVoiceSummary = async () => {
    if (!accessToken) return;
    setSpeaking(true);
    try {
      const s = await getTaskSummary(accessToken);
      speakSummary(s.summary);
      setTimeout(() => setSpeaking(false), 4000);
    } catch { setSpeaking(false); }
  };

  const done = tasks.filter(t => t.status === 'done').length;
  const overallProgress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  return (
    <>
      {/* Backdrop */}
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)', zIndex: 40,
      }} />

      {/* Panel */}
      <div ref={panelRef} style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: '420px', zIndex: 50,
        background: 'linear-gradient(180deg, #0d0f18 0%, #0a0c14 100%)',
        borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        animation: 'slideInRight 0.3s var(--ease-spring)',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.6)',
      }}>

        {/* Header */}
        <div style={{
          padding: '1.25rem 1.25rem 1rem',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(99,102,241,0.05)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.9rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <div style={{
                width: '32px', height: '32px', borderRadius: '10px',
                background: 'linear-gradient(135deg, rgba(99,102,241,0.3) 0%, rgba(139,92,246,0.2) 100%)',
                border: '1px solid rgba(99,102,241,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem',
              }}>📋</div>
              <div>
                <div style={{ fontFamily: 'var(--font-head)', fontWeight: '600', fontSize: '0.95rem' }}>Task Manager</div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                  {summary ? `${summary.done}/${summary.total} completed` : 'Loading...'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {/* Voice summary */}
              <button onClick={handleVoiceSummary} data-tooltip="Voice Summary"
                style={{
                  width: '32px', height: '32px', borderRadius: 'var(--r-md)',
                  background: speaking ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.04)',
                  border: speaking ? '1px solid rgba(16,185,129,0.4)' : '1px solid var(--border)',
                  color: speaking ? 'var(--success)' : 'var(--text-muted)',
                  cursor: 'pointer', fontSize: '0.9rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all var(--dur-fast)',
                  animation: speaking ? 'pulsing 1s ease-in-out infinite' : 'none',
                }}>
                {speaking ? '🔊' : '🔈'}
              </button>
              {/* Close */}
              <button onClick={onClose}
                style={{
                  width: '32px', height: '32px', borderRadius: 'var(--r-md)',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
                  color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all var(--dur-fast)',
                }}>✕</button>
            </div>
          </div>

          {/* Overall progress */}
          {tasks.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Overall Progress</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--accent-light)', fontWeight: '600' }}>{overallProgress}%</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${overallProgress}%` }} />
              </div>
              {/* Stats row */}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.7rem' }}>
                {[
                  { label: 'Total', val: summary?.total ?? 0, color: 'var(--accent-light)' },
                  { label: 'Done', val: summary?.done ?? 0, color: 'var(--success)' },
                  { label: 'Active', val: summary?.in_progress ?? 0, color: 'var(--accent-cyan)' },
                  { label: 'Pending', val: summary?.todo ?? 0, color: 'var(--warning)' },
                ].map(s => (
                  <div key={s.label} style={{
                    flex: 1, textAlign: 'center', padding: '0.4rem',
                    background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--r-sm)',
                    border: '1px solid var(--border)',
                  }}>
                    <div style={{ fontSize: '1rem', fontWeight: '700', color: s.color, fontFamily: 'var(--font-mono)' }}>{s.val}</div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Task list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              <div className="pulsing" style={{ fontSize: '1.5rem' }}>⏳</div>
            </div>
          ) : tasks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem', opacity: 0.4 }}>📋</div>
              <p style={{ fontSize: '0.85rem', marginBottom: '0.3rem', color: 'var(--text-secondary)' }}>No tasks yet</p>
              <p style={{ fontSize: '0.75rem' }}>Click + Add Task to get started</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {tasks.map(task => {
                const pMeta = PRIORITY_META[task.priority] ?? PRIORITY_META.medium;
                const sMeta = STATUS_META[task.status] ?? STATUS_META.todo;
                return (
                  <div key={task.id} className="card-3d" style={{
                    borderRadius: 'var(--r-lg)', padding: '0.9rem 1rem',
                    animation: 'fadeUp 0.2s var(--ease)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                      {/* Status toggle circle */}
                      <button onClick={() => handleCycleStatus(task)}
                        title="Click to advance status"
                        style={{
                          width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0, marginTop: '2px',
                          background: task.status === 'done' ? 'var(--success)' : task.status === 'in_progress' ? 'var(--accent-cyan)' : 'transparent',
                          border: `2px solid ${sMeta.color}`,
                          cursor: 'pointer', transition: 'all var(--dur-fast)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.6rem',
                        }}>
                        {task.status === 'done' ? '✓' : ''}
                      </button>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                          <span style={{
                            fontSize: '0.85rem', fontWeight: '500',
                            color: task.status === 'done' ? 'var(--text-muted)' : 'var(--text-primary)',
                            textDecoration: task.status === 'done' ? 'line-through' : 'none',
                            flex: 1, minWidth: 0,
                          }}>{task.title}</span>
                          {/* Priority badge */}
                          <span style={{
                            fontSize: '0.62rem', fontWeight: '600', padding: '1px 6px',
                            borderRadius: '999px', background: pMeta.bg, color: pMeta.color,
                            border: `1px solid ${pMeta.color}30`, flexShrink: 0,
                          }}>{pMeta.label}</span>
                        </div>

                        {task.description && (
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem', lineHeight: 1.4 }}>
                            {task.description}
                          </p>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {/* Status label */}
                          <span style={{ fontSize: '0.68rem', color: sMeta.color, fontWeight: '500' }}>{sMeta.label}</span>
                          {task.due_date && (
                            <>
                              <span style={{ color: 'var(--border)', fontSize: '0.7rem' }}>·</span>
                              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>📅 {task.due_date}</span>
                            </>
                          )}
                          <div style={{ flex: 1 }} />
                          {/* Delete */}
                          <button onClick={() => handleDelete(task.id)}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: 'var(--text-muted)', fontSize: '0.75rem', padding: '2px 4px',
                              borderRadius: '4px', transition: 'color var(--dur-fast)',
                            }}
                            onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
                            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                          >✕</button>
                        </div>

                        {/* Progress bar */}
                        {task.status !== 'todo' && (
                          <div style={{ marginTop: '0.5rem' }}>
                            <div className="progress-track">
                              <div className="progress-fill" style={{ width: `${task.progress}%` }} />
                            </div>
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

        {/* Add task form */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '0.75rem' }}>
          {showAdd ? (
            <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', animation: 'fadeUp 0.15s var(--ease)' }}>
              <input
                autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)}
                placeholder="Task title..."
                className="input-glass"
                style={{ padding: '0.6rem 0.85rem', fontSize: '0.85rem', width: '100%' }}
              />
              <input
                value={newDesc} onChange={e => setNewDesc(e.target.value)}
                placeholder="Description (optional)"
                className="input-glass"
                style={{ padding: '0.6rem 0.85rem', fontSize: '0.82rem', width: '100%' }}
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <select value={newPriority} onChange={e => setNewPriority(e.target.value as any)}
                  className="input-glass"
                  style={{ flex: 1, padding: '0.55rem 0.7rem', fontSize: '0.82rem', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
                  <option value="low">Low priority</option>
                  <option value="medium">Medium priority</option>
                  <option value="high">High priority</option>
                </select>
                <input type="date" value={newDue} onChange={e => setNewDue(e.target.value)}
                  className="input-glass"
                  style={{ flex: 1, padding: '0.55rem 0.7rem', fontSize: '0.82rem', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="submit" className="btn-primary"
                  style={{ flex: 1, padding: '0.6rem', fontSize: '0.82rem', fontWeight: '600' }}>
                  Add Task
                </button>
                <button type="button" className="btn-ghost"
                  onClick={() => setShowAdd(false)}
                  style={{ padding: '0.6rem 1rem', fontSize: '0.82rem' }}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button onClick={() => setShowAdd(true)} className="btn-primary"
              style={{ width: '100%', padding: '0.7rem', fontSize: '0.85rem', fontWeight: '600', borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: '1rem' }}>+</span> Add Task
            </button>
          )}
        </div>
      </div>
    </>
  );
}
