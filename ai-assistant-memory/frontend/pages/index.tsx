import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import ChatWindow from '../components/ChatWindow';
import MemoryInspector from '../components/MemoryInspector';

export default function Home() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'chat' | 'memory'>('chat');
  const [userId, setUserId] = useState('demo_user_123');

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {/* Sidebar */}
      <div style={{ width: '280px', background: 'var(--bg-surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border)' }}>
          <h1 style={{ color: 'var(--accent)', margin: 0, fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            🧠 MemAI
          </h1>
        </div>

        <div style={{ padding: '1.5rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <button 
            onClick={() => setActiveTab('chat')}
            style={{ textAlign: 'left', padding: '0.8rem 1rem', background: activeTab === 'chat' ? 'var(--bg-card)' : 'transparent', color: activeTab === 'chat' ? 'var(--accent-light)' : 'var(--text-secondary)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: activeTab === 'chat' ? 'bold' : 'normal' }}
          >
            💬 Chat
          </button>
          <button 
            onClick={() => setActiveTab('memory')}
            style={{ textAlign: 'left', padding: '0.8rem 1rem', background: activeTab === 'memory' ? 'var(--bg-card)' : 'transparent', color: activeTab === 'memory' ? 'var(--accent-light)' : 'var(--text-secondary)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: activeTab === 'memory' ? 'bold' : 'normal' }}
          >
            🧠 Memories
          </button>

          <div style={{ marginTop: '2rem', padding: '1rem', background: 'var(--bg-elevated)', borderRadius: '6px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Active User ID</label>
            <input 
              type="text" 
              value={userId} 
              onChange={e => setUserId(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'white', borderRadius: '4px' }}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem', lineHeight: 1.4 }}>
              Change this ID to test isolated memory sessions.
            </p>
          </div>
        </div>


      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, position: 'relative' }}>
        {activeTab === 'chat' ? (
          <ChatWindow userId={userId} />
        ) : (
          <MemoryInspector userId={userId} />
        )}
      </div>
    </div>
  );
}
