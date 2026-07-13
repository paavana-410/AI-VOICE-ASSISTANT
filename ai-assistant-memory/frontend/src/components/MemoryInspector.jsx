import { useState, useEffect, useCallback } from 'react'
import { listMemories, searchMemories, updateMemory, deleteMemory, deleteAllMemories } from '../api.js'
import './MemoryInspector.css'

export default function MemoryInspector({ userId }) {
  const [memories, setMemories]   = useState([])
  const [loading, setLoading]     = useState(false)
  const [searchQ, setSearchQ]     = useState('')
  const [editId, setEditId]       = useState(null)
  const [editText, setEditText]   = useState('')
  const [error, setError]         = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = searchQ.trim()
        ? await searchMemories(searchQ, userId)
        : await listMemories(userId)
      setMemories(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [userId, searchQ])

  useEffect(() => { load() }, [load])

  async function handleDelete(id) {
    if (!confirm('Delete this memory?')) return
    try {
      await deleteMemory(id)
      setMemories(prev => prev.filter(m => m.id !== id))
    } catch (err) { setError(err.message) }
  }

  async function handleDeleteAll() {
    if (!confirm(`Delete ALL memories for "${userId}"?`)) return
    try {
      await deleteAllMemories(userId)
      setMemories([])
    } catch (err) { setError(err.message) }
  }

  async function handleSaveEdit(id) {
    try {
      await updateMemory(id, editText, userId)
      setMemories(prev => prev.map(m => m.id === id ? { ...m, memory: editText } : m))
      setEditId(null)
    } catch (err) { setError(err.message) }
  }

  return (
    <div className="inspector">
      <div className="inspector-header">
        <h2>🧠 Memory Inspector</h2>
        <p className="sub">What the assistant remembers about <strong>{userId}</strong></p>
      </div>

      <div className="search-row">
        <input
          id="memory-search"
          type="text"
          placeholder="Search memories…"
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
        />
        <button id="refresh-btn" className="btn-icon" onClick={load} title="Refresh">↺</button>
        {memories.length > 0 && (
          <button id="delete-all-btn" className="btn-danger" onClick={handleDeleteAll}>
            Clear all
          </button>
        )}
      </div>

      {error && <div className="error-toast">⚠ {error}</div>}

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : memories.length === 0 ? (
        <div className="empty-state">
          {searchQ ? 'No memories matched your search.' : 'No memories stored yet. Start chatting!'}
        </div>
      ) : (
        <ul className="memory-list">
          {memories.map(m => (
            <li key={m.id} className="memory-card">
              {editId === m.id ? (
                <div className="edit-row">
                  <textarea
                    id={`edit-${m.id}`}
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    rows={3}
                  />
                  <div className="edit-actions">
                    <button id={`save-${m.id}`} className="btn-save" onClick={() => handleSaveEdit(m.id)}>Save</button>
                    <button id={`cancel-${m.id}`} className="btn-cancel" onClick={() => setEditId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="memory-text">{m.memory}</p>
                  {m.score != null && (
                    <span className="score-badge">score: {m.score.toFixed(3)}</span>
                  )}
                  <div className="card-actions">
                    <button
                      id={`edit-btn-${m.id}`}
                      className="btn-edit"
                      onClick={() => { setEditId(m.id); setEditText(m.memory) }}
                    >✏ Edit</button>
                    <button
                      id={`delete-btn-${m.id}`}
                      className="btn-del"
                      onClick={() => handleDelete(m.id)}
                    >🗑 Delete</button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="count-bar">{memories.length} memor{memories.length === 1 ? 'y' : 'ies'}</div>
    </div>
  )
}
