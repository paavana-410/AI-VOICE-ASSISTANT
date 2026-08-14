/**
 * ChatHistoryPanel.tsx
 * Lists past chat sessions. Click a session → loads it into ChatWindow.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../src/authContext';
import { getSessions, getSession, deleteSession, ChatSession } from '../src/api';

interface Props {
  onLoadSession: (messages: { role: string; content: string }[]) => void;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'Just now';
}

export default function ChatHistoryPanel({ onLoadSession }: Props) {
  const { accessToken } = useAuth();
  const [sessions, setSessions]     = useState<ChatSession[]>([]);
  const [loading, setLoading]       = useState(true);
  const [loadingId, setLoadingId]   = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try { setSessions(await getSessions(accessToken)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  const handleOpen = async (id: string) => {
    if (!accessToken) return;
    setLoadingId(id);
    try {
      const detail = await getSession(accessToken, id);
      onLoadSession(detail.messages.map(m => ({ role: m.role, content: m.content })));
    } catch (e) { console.error(e); }
    finally { setLoadingId(null); }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!accessToken) return;
    setDeletingId(id);
    try {
      await deleteSession(accessToken, id);
      setSessions(p => p.filter(s => s.id !== id));
    } catch (e) { console.error(e); }
    finally { setDeletingId(null); }
  };

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
      <span className="pulsing" style={{ fontSize: '0.85rem' }}>Loading history...</span>
    </div>
  );

  if (sessions.length === 0) return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', padding: '2rem', gap: '0.75rem' }}>
      <span style={{ fontSize: '2.5rem', opacity: 0.3 }}>🕐</span>
      <p style={{ fontSize: '0.83rem', textAlign: 'center' }}>No past conversations yet.</p>
      <p style={{ fontSize: '0.72rem', textAlign: 'center', opacity: 0.6 }}>Start chatting — sessions are saved automatically.</p>
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0.65rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {sessions.map(s => (
        <div
          key={s.id}
          onClick={() => handleOpen(s.id)}
          style={{
            padding: '0.85rem 1rem', borderRadius: 'var(--r-md)',
            background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
            cursor: 'pointer', transition: 'all var(--dur-fast)',
            animation: 'fadeUp 0.2s var(--ease)',
            opacity: loadingId === s.id ? 0.6 : 1,
            position: 'relative',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(99,102,241,0.08)';
            e.currentTarget.style.borderColor = 'rgba(99,102,241,0.2)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
            e.currentTarget.style.borderColor = 'var(--border)';
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem' }}>
            {/* Icon */}
            <div style={{
              width: '32px', height: '32px', borderRadius: '9px', flexShrink: 0,
              background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem',
            }}>
              {loadingId === s.id ? <span className="pulsing">⏳</span> : '💬'}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Title */}
              <div style={{
                fontSize: '0.83rem', fontWeight: '500', color: 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                marginBottom: '0.2rem',
              }}>{s.title}</div>

              {/* Preview */}
              {s.preview && (
                <div style={{
                  fontSize: '0.72rem', color: 'var(--text-muted)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  marginBottom: '0.3rem',
                }}>{s.preview}</div>
              )}

              {/* Meta row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  🕐 {timeAgo(s.updated_at)}
                </span>
                <span style={{ color: 'var(--border)', fontSize: '0.65rem' }}>·</span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {s.message_count} msg{s.message_count !== 1 ? 's' : ''}
                </span>
              </div>
            </div>

            {/* Delete */}
            <button
              onClick={e => handleDelete(e, s.id)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', fontSize: '0.75rem', padding: '2px 4px',
                borderRadius: '4px', transition: 'color var(--dur-fast)', flexShrink: 0,
                opacity: deletingId === s.id ? 0.4 : 1,
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
            >✕</button>
          </div>
        </div>
      ))}
    </div>
  );
}
