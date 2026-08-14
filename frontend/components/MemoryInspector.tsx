import React, { useState, useEffect } from 'react';
import { useAuth } from '../src/authContext';
import { getMemories, addMemory, deleteMemory } from '../src/api';

export default function MemoryInspector() {
  const { accessToken } = useAuth();
  const [memories, setMemories] = useState<any[]>([]);
  const [newMemory, setNewMemory] = useState('');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const fetchMemories = async () => {
    if (!accessToken) return;
    setLoading(true);
    try { setMemories(await getMemories(accessToken)); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchMemories(); }, [accessToken]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemory.trim() || !accessToken) return;
    await addMemory(accessToken, newMemory);
    setNewMemory('');
    fetchMemories();
  };

  const handleDelete = async (id: string) => {
    if (!accessToken) return;
    await deleteMemory(accessToken, id);
    fetchMemories();
  };

  const filtered = memories.filter(m =>
    !search || m.memory?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '1.5rem 1.75rem 1.25rem',
        borderBottom: '1px solid var(--border)',
        background: 'rgba(13,15,24,0.9)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: '700', fontSize: '1.1rem', marginBottom: '2px' }}>
              🧠 Knowledge Base
            </h2>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {memories.length} memor{memories.length !== 1 ? 'ies' : 'y'} stored
            </p>
          </div>
          <button onClick={fetchMemories}
            style={{
              padding: '0.45rem 0.9rem', fontSize: '0.78rem',
              background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', borderRadius: 'var(--r-md)',
              cursor: 'pointer', fontFamily: 'var(--font-body)',
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              transition: 'all var(--dur-fast)',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-accent)'; e.currentTarget.style.color = 'var(--accent-light)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            {loading ? <span className="pulsing">⟳</span> : '⟳'} Refresh
          </button>
        </div>

        {/* Search */}
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍  Search memories..."
          className="input-glass"
          style={{ width: '100%', padding: '0.6rem 0.9rem', fontSize: '0.85rem' }}
        />
      </div>

      {/* Add memory */}
      <div style={{ padding: '1rem 1.75rem', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: '0.6rem' }}>
          <input
            value={newMemory} onChange={e => setNewMemory(e.target.value)}
            placeholder="Add a fact manually..."
            className="input-glass"
            style={{ flex: 1, padding: '0.6rem 0.9rem', fontSize: '0.85rem' }}
          />
          <button type="submit" className="btn-primary"
            style={{ padding: '0.6rem 1.1rem', fontSize: '0.82rem', fontWeight: '600', borderRadius: 'var(--r-lg)', whiteSpace: 'nowrap' }}>
            + Add
          </button>
        </form>
      </div>

      {/* Memory list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.75rem' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem', opacity: 0.3 }}>🧠</div>
            <p style={{ fontSize: '0.85rem' }}>{search ? 'No memories match your search' : 'No memories yet — start chatting!'}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {filtered.map((m, i) => (
              <div key={m.id ?? i} className="card-3d" style={{
                borderRadius: 'var(--r-lg)', padding: '0.85rem 1rem',
                display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                animation: 'fadeUp 0.2s var(--ease)',
              }}>
                <div style={{
                  width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0,
                  background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem',
                }}>💡</div>
                <p style={{ flex: 1, fontSize: '0.83rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {m.memory}
                </p>
                <button onClick={() => handleDelete(m.id)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-muted)', fontSize: '0.8rem', flexShrink: 0,
                    padding: '2px', borderRadius: '4px', transition: 'color var(--dur-fast)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
