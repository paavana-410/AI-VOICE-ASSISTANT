import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import ChatWindow from '../components/ChatWindow';
import MemoryInspector from '../components/MemoryInspector';
import FileUpload from '../components/FileUpload';
import RightPanel from '../components/RightPanel';
import Analytics from '../components/Analytics';
import { useAuth } from '../src/authContext';

type Tab = 'chat' | 'upload' | 'memory' | 'analytics';

const TABS: { id: Tab; label: string; icon: string; desc: string }[] = [
  { id: 'chat',      label: 'Chat',       icon: '💬', desc: 'AI Assistant' },
  { id: 'upload',    label: 'Documents',  icon: '📂', desc: 'Upload & Ingest' },
  { id: 'memory',    label: 'Memories',   icon: '🧠', desc: 'Knowledge Base' },
  { id: 'analytics', label: 'Analytics',  icon: '📈', desc: 'Usage & Insights' },
];

// ── Hamburger icon ────────────────────────────────────────────────────────────
function HamburgerIcon({ open }: { open: boolean }) {
  const bar = (y: number, rotate?: string) => (
    <div style={{
      width: '16px', height: '1.5px',
      background: open ? 'var(--accent-light)' : 'var(--text-secondary)',
      borderRadius: '2px',
      transition: 'all 0.2s var(--ease)',
      transformOrigin: 'center',
      transform: rotate ?? 'none',
      position: rotate ? 'absolute' : 'relative',
      top: rotate ? '50%' : 'auto',
    }} />
  );
  return (
    <div style={{ width: '16px', height: '12px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative' }}>
      {!open ? (
        <>
          <div style={{ width: '16px', height: '1.5px', background: 'var(--text-secondary)', borderRadius: '2px' }} />
          <div style={{ width: '12px', height: '1.5px', background: 'var(--text-secondary)', borderRadius: '2px' }} />
          <div style={{ width: '16px', height: '1.5px', background: 'var(--text-secondary)', borderRadius: '2px' }} />
        </>
      ) : (
        // X shape when open
        <>
          <div style={{ width: '16px', height: '1.5px', background: 'var(--accent-light)', borderRadius: '2px', transform: 'rotate(45deg) translate(4px, 4px)' }} />
          <div style={{ width: '16px', height: '1.5px', background: 'transparent' }} />
          <div style={{ width: '16px', height: '1.5px', background: 'var(--accent-light)', borderRadius: '2px', transform: 'rotate(-45deg) translate(4px, -4px)' }} />
        </>
      )}
    </div>
  );
}

// ── Live clock ────────────────────────────────────────────────────────────────
function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const ampm   = now.getHours() >= 12 ? 'PM' : 'AM';
  const h12    = (now.getHours() % 12 || 12).toString().padStart(2, '0');
  const mm     = now.getMinutes().toString().padStart(2, '0');
  const ss     = now.getSeconds().toString().padStart(2, '0');

  return (
    <div style={{
      margin: '0.75rem',
      borderRadius: 'var(--r-xl)',
      background: 'linear-gradient(145deg, rgba(99,102,241,0.12) 0%, rgba(34,211,238,0.06) 100%)',
      border: '1px solid rgba(99,102,241,0.2)',
      padding: '1rem',
      position: 'relative', overflow: 'hidden',
      boxShadow: '0 4px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
    }}>
      <div style={{ position: 'absolute', top: '-20px', right: '-20px', width: '80px', height: '80px', background: 'radial-gradient(circle, rgba(99,102,241,0.3) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '1.6rem', fontWeight: '500',
        letterSpacing: '0.05em', lineHeight: 1, marginBottom: '0.4rem',
        background: 'linear-gradient(135deg, #f0f2ff 0%, #a78bfa 100%)',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
      }}>
        {h12}:{mm}
        <span style={{ fontSize: '1rem', opacity: 0.6 }}>:{ss}</span>
        <span style={{ fontSize: '0.62rem', fontFamily: 'var(--font-body)', fontWeight: '600', letterSpacing: '0.08em', WebkitTextFillColor: 'var(--accent-light)', marginLeft: '0.3rem' }}>{ampm}</span>
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: '500' }}>
        {days[now.getDay()]}, {months[now.getMonth()]} {now.getDate()}, {now.getFullYear()}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Home() {
  const router = useRouter();
  const { logout } = useAuth();
  const [activeTab, setActiveTab]   = useState<Tab>('chat');
  const [panelOpen, setPanelOpen]   = useState(false);
  // Loaded session messages pushed down into ChatWindow via a ref callback
  const loadSessionRef = useRef<((msgs: { role: string; content: string }[]) => void) | null>(null);

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  const handleLoadSession = (msgs: { role: string; content: string }[]) => {
    // Switch to chat tab, then push messages into ChatWindow
    setActiveTab('chat');
    // Give ChatWindow a tick to mount if not already shown
    setTimeout(() => {
      if (loadSessionRef.current) loadSessionRef.current(msgs);
    }, 50);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg-base)', overflow: 'hidden', position: 'relative' }}>

      {/* ── Left Sidebar ── */}
      <aside style={{
        width: '220px', flexShrink: 0,
        background: 'linear-gradient(180deg, rgba(13,15,24,0.98) 0%, rgba(7,8,13,0.98) 100%)',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        backdropFilter: 'blur(40px)',
        position: 'relative', zIndex: 10,
        boxShadow: '4px 0 24px rgba(0,0,0,0.4)',
      }}>
        {/* Logo */}
        <div style={{ padding: '1.25rem 1.25rem 1rem', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '10px',
              background: 'var(--grad-accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1rem', boxShadow: 'var(--shadow-accent)', flexShrink: 0,
            }}>🧠</div>
            <div>
              <div style={{ fontFamily: 'var(--font-head)', fontWeight: '700', fontSize: '1.1rem', letterSpacing: '-0.02em', background: 'var(--grad-accent)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>MemAI</div>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Business Assistant</div>
            </div>
          </div>
        </div>

        {/* Clock */}
        <LiveClock />

        {/* Divider */}
        <div style={{ height: '1px', background: 'linear-gradient(90deg, transparent, var(--border), transparent)', margin: '0 1rem' }} />

        {/* Nav */}
        <nav style={{ padding: '0.75rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {TABS.map(tab => {
            const active = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.65rem',
                  padding: '0.65rem 0.85rem',
                  background: active ? 'linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(139,92,246,0.08) 100%)' : 'transparent',
                  border: active ? '1px solid rgba(99,102,241,0.25)' : '1px solid transparent',
                  borderRadius: 'var(--r-md)', cursor: 'pointer',
                  transition: 'all var(--dur-fast) var(--ease)', textAlign: 'left', width: '100%',
                  boxShadow: active ? 'inset 0 1px 0 rgba(255,255,255,0.05)' : 'none',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-glass-hover)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{
                  width: '28px', height: '28px', borderRadius: '8px',
                  background: active ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.9rem', flexShrink: 0,
                  border: active ? '1px solid rgba(99,102,241,0.3)' : '1px solid transparent',
                  transition: 'all var(--dur-fast)',
                }}>{tab.icon}</span>
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: active ? '600' : '400', color: active ? 'var(--accent-light)' : 'var(--text-secondary)', lineHeight: 1.2, transition: 'color var(--dur-fast)' }}>{tab.label}</div>
                  <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '1px' }}>{tab.desc}</div>
                </div>
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border)' }}>
          <button onClick={handleLogout}
            style={{
              width: '100%', padding: '0.6rem 0.85rem', background: 'transparent',
              border: '1px solid var(--border)', color: 'var(--text-muted)',
              borderRadius: 'var(--r-md)', cursor: 'pointer', fontSize: '0.8rem',
              fontFamily: 'var(--font-body)',
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              transition: 'all var(--dur-fast)',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)'; e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.05)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ fontSize: '0.9rem' }}>⏻</span> Sign Out
          </button>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>

        {/* Top bar */}
        <div style={{
          height: '52px', flexShrink: 0,
          background: 'rgba(13,15,24,0.85)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 1.25rem', position: 'relative', zIndex: 5,
        }}>
          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{TABS.find(t => t.id === activeTab)?.icon}</span>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: '500' }}>{TABS.find(t => t.id === activeTab)?.label}</span>
          </div>

          {/* ≡ Hamburger button */}
          <button
            onClick={() => setPanelOpen(v => !v)}
            title="Menu"
            style={{
              width: '36px', height: '36px', borderRadius: 'var(--r-md)',
              background: panelOpen ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
              border: panelOpen ? '1px solid rgba(99,102,241,0.4)' : '1px solid var(--border)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all var(--dur-fast)',
              boxShadow: panelOpen ? 'var(--shadow-accent)' : 'none',
            }}
            onMouseEnter={e => { if (!panelOpen) { e.currentTarget.style.background = 'rgba(99,102,241,0.1)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)'; } }}
            onMouseLeave={e => { if (!panelOpen) { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'var(--border)'; } }}
          >
            <HamburgerIcon open={panelOpen} />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {activeTab === 'chat'      && <ChatWindow onRegisterLoader={fn => { loadSessionRef.current = fn; }} />}
          {activeTab === 'upload'    && <FileUpload />}
          {activeTab === 'memory'    && <MemoryInspector />}
          {activeTab === 'analytics' && <Analytics />}
        </div>
      </div>

      {/* Right slide-in panel */}
      {panelOpen && (
        <RightPanel
          onClose={() => setPanelOpen(false)}
          onLoadSession={handleLoadSession}
        />
      )}
    </div>
  );
}
