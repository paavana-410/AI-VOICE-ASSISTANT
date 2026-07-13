import { useState, useRef, useEffect } from 'react'
import { sendChat, sendCrewChat } from '../api.js'
import './ChatWindow.css'

const MODES = [
  { key: 'single', label: '⚡ Single Agent', desc: 'LangChain + Groq' },
  { key: 'crew',   label: '🤖 Multi-Agent',  desc: 'CrewAI (Researcher + Assistant)' },
]

export default function ChatWindow({ userId }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "Hi! I'm your AI assistant with persistent memory. Tell me something about yourself — I'll remember it across sessions! 🧠",
    },
  ])
  const [input, setInput]   = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode]     = useState('single')
  const [error, setError]   = useState(null)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function handleSend(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    setMessages(prev => [...prev, { role: 'user', content: text }])
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const fn   = mode === 'crew' ? sendCrewChat : sendChat
      const data = await fn(text, userId)
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="chat-window">
      {/* Mode selector */}
      <div className="mode-bar">
        {MODES.map(m => (
          <button
            key={m.key}
            id={`mode-btn-${m.key}`}
            className={`mode-btn ${mode === m.key ? 'active' : ''} ${m.key}`}
            onClick={() => setMode(m.key)}
          >
            <span className="mode-label">{m.label}</span>
            <span className="mode-desc">{m.desc}</span>
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="messages">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="bubble">{msg.content}</div>
          </div>
        ))}

        {loading && (
          <div className="message assistant">
            <div className="bubble typing">
              <span /><span /><span />
            </div>
          </div>
        )}

        {error && <div className="error-toast">⚠ {error}</div>}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form className="input-row" onSubmit={handleSend}>
        <input
          id="chat-input"
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Type a message…"
          disabled={loading}
          autoComplete="off"
        />
        <button id="send-btn" type="submit" disabled={loading || !input.trim()}>
          {loading ? '…' : '↑'}
        </button>
      </form>
    </div>
  )
}
