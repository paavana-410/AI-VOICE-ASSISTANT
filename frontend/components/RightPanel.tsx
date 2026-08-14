/**
 * RightPanel.tsx
 * Hamburger (≡) slide-in panel — Menu → Chat History / Tasks / Memories / Documents
 */
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../src/authContext';
import { getMemories } from '../src/api';
import ChatHistoryPanel from './ChatHistoryPanel';
import TaskManagerInner from './TaskManagerInner';

type Section = 'home' | 'history' | 'tasks' | 'memories' | 'documents';

interface Props {
  onClose: () => void;
  onLoadSession: (messages: { role: string; content: string }[]) => void;
}

const NAV_ITEMS: { id: Section; icon: string; label: string; desc: string }[] = [
  { id: 'history',   icon: '🕐', label: 'Chat History',  desc: 'Past conversations' },
  { id: 'tasks',     icon: '✅', label: 'Tasks',         desc: 'Track your work' },
  { id: 'memories',  icon: '🧠', label: 'Memories',      desc: 'Stored knowledge' },
  { id: 'documents', icon: '📂', label: 'Documents',     desc: 'Upload & ingest files' },
];

export default function RightPanel({ onClose, onLoadSession }: Props) {
  const [section, setSection] = useState<Section>('home');
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', h), 100);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', h); };
  }, [onClose]);

  const sectionTitle = section === 'home' ? 'Menu' : NAV_ITEMS.find(n => n.id === section)?.label ?? '';

  return (
    <>
      {/* Backdrop */}
      <div style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)',
        zIndex: 40,
      }} />

      {/* Slide-in panel */}
      <div ref={panelRef} style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: section === 'home' ? '280px' : '420px',
        zIndex: 50,
        background: 'linear-gradient(180deg, #0d0f18 0%, #090b12 100%)',
        borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 48px rgba(0,0,0,0.7)',
        animation: 'slideInRight 0.28s var(--ease-spring)',
        transition: 'width 0.22s var(--ease)',
      }}>

        {/* Header */}
        <div style={{
          padding: '1rem',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'rgba(99,102,241,0.04)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {section !== 'home' && (
              <button onClick={() => setSection('home')}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', fontSize: '1rem', lineHeight: 1,
                  padding: '2px 6px', borderRadius: '4px',
                  transition: 'color var(--dur-fast)',
                }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              >←</button>
            )}
            <span style={{
              fontFamily: 'var(--font-head)', fontWeight: '600',
              fontSize: '0.9rem', color: 'var(--text-primary)',
            }}>{sectionTitle}</span>
          </div>
          <button onClick={onClose}
            style={{
              width: '28px', height: '28px', borderRadius: 'var(--r-sm)',
              background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
              color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all var(--dur-fast)',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)'; e.currentTarget.style.color = 'var(--danger)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >✕</button>
        </div>

        {/* Section content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {section === 'home'      && <HomeMenu onSelect={setSection} />}
          {section === 'history'   && <ChatHistoryPanel onLoadSession={msgs => { onLoadSession(msgs); onClose(); }} />}
          {section === 'tasks'     && <TaskManagerInner />}
          {section === 'memories'  && <InlineMemories />}
          {section === 'documents' && <InlineDocuments />}
        </div>
      </div>
    </>
  );
}

// ── Home menu grid ────────────────────────────────────────────────────────────
function HomeMenu({ onSelect }: { onSelect: (s: Section) => void }) {
  return (
    <div style={{ padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      {NAV_ITEMS.map((item, i) => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.85rem',
            padding: '0.85rem 1rem', width: '100%', textAlign: 'left',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)', cursor: 'pointer',
            transition: 'all var(--dur-fast)', fontFamily: 'var(--font-body)',
            animation: `fadeUp ${0.1 + i * 0.05}s var(--ease)`,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(99,102,241,0.1)';
            e.currentTarget.style.borderColor = 'rgba(99,102,241,0.25)';
            e.currentTarget.style.transform = 'translateX(3px)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.transform = 'translateX(0)';
          }}
        >
          <span style={{
            width: '38px', height: '38px', borderRadius: '10px', flexShrink: 0,
            background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
          }}>{item.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.87rem', fontWeight: '500', color: 'var(--text-primary)', marginBottom: '1px' }}>{item.label}</div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{item.desc}</div>
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', transition: 'transform var(--dur-fast)' }}>›</span>
        </button>
      ))}
    </div>
  );
}

// ── Inline Memories ───────────────────────────────────────────────────────────
function InlineMemories() {
  const { accessToken } = useAuth();
  const [memories, setMemories] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    getMemories(accessToken)
      .then(setMemories)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken]);

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
      <span className="pulsing" style={{ fontSize: '0.83rem' }}>Loading memories...</span>
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0.65rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {memories.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>No memories stored yet.</div>
      ) : memories.map((m, i) => (
        <div key={m.id ?? i} style={{
          padding: '0.7rem 0.85rem', borderRadius: 'var(--r-md)',
          background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
          fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5,
          display: 'flex', gap: '0.5rem', alignItems: 'flex-start',
          animation: 'fadeUp 0.2s var(--ease)',
        }}>
          <span style={{ opacity: 0.35, flexShrink: 0, marginTop: '1px' }}>💡</span>
          <span>{m.memory}</span>
        </div>
      ))}
    </div>
  );
}

// ── Inline Documents notice ───────────────────────────────────────────────────
function InlineDocuments() {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '0.75rem', color: 'var(--text-muted)', padding: '2rem', textAlign: 'center',
    }}>
      <span style={{ fontSize: '2.5rem', opacity: 0.3 }}>📂</span>
      <p style={{ fontSize: '0.87rem', color: 'var(--text-secondary)', fontWeight: '500' }}>Upload Documents</p>
      <p style={{ fontSize: '0.75rem', lineHeight: 1.6 }}>
        Use the <strong style={{ color: 'var(--accent-light)' }}>Documents</strong> tab in the left sidebar to upload PDF, Word, Excel, and image files into memory.
      </p>
    </div>
  );
}
