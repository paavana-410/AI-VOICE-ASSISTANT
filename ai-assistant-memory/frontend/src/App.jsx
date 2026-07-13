import { useState } from 'react'
import ChatWindow from './components/ChatWindow.jsx'
import MemoryInspector from './components/MemoryInspector.jsx'
import './App.css'

const TABS = [
  { key: 'chat',   label: '💬 Chat' },
  { key: 'memory', label: '🧠 Memories' },
]

const DEFAULT_USER = 'demo_user'

export default function App() {
  const [tab, setTab]       = useState('chat')
  const [userId, setUserId] = useState(DEFAULT_USER)
  const [editingUser, setEditingUser] = useState(false)
  const [tempUser, setTempUser]       = useState(DEFAULT_USER)

  function applyUser(e) {
    e.preventDefault()
    if (tempUser.trim()) setUserId(tempUser.trim())
    setEditingUser(false)
  }

  return (
    <div className="app">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-icon">🤖</span>
          <div>
            <div className="logo-title">MemAI</div>
            <div className="logo-sub">Assistant with Memory</div>
          </div>
        </div>

        <nav className="nav">
          {TABS.map(t => (
            <button
              key={t.key}
              id={`tab-${t.key}`}
              className={`nav-btn ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="user-panel">
          <div className="user-label">User ID</div>
          {editingUser ? (
            <form onSubmit={applyUser} className="user-form">
              <input
                id="user-id-input"
                value={tempUser}
                onChange={e => setTempUser(e.target.value)}
                autoFocus
              />
              <button id="user-apply-btn" type="submit">✓</button>
            </form>
          ) : (
            <button
              id="user-id-btn"
              className="user-chip"
              onClick={() => { setTempUser(userId); setEditingUser(true) }}
              title="Click to change user"
            >
              👤 {userId}
            </button>
          )}
        </div>

        <footer className="sidebar-footer">
          <p>Stack: Groq · Mem0 · MongoDB Atlas · MCP · CrewAI</p>
          <p>$0 / month</p>
        </footer>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <main className="main">
        {tab === 'chat' && <ChatWindow userId={userId} />}
        {tab === 'memory' && <MemoryInspector userId={userId} />}
      </main>
    </div>
  )
}
