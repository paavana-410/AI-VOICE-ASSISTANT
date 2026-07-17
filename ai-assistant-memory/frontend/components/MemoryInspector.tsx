import React, { useState, useEffect } from 'react';
import { getMemories, addMemory, deleteMemory } from '../src/api';

export default function MemoryInspector({ userId }: { userId: string }) {
  const [memories, setMemories] = useState<any[]>([]);
  const [newMemory, setNewMemory] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchMemories = async () => {
    setLoading(true);
    try {
      const data = await getMemories(userId);
      setMemories(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMemories();
  }, [userId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemory.trim()) return;
    try {
      await addMemory(newMemory, userId);
      setNewMemory('');
      fetchMemories();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMemory(id, userId);
      fetchMemories();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="memory-inspector" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2>Memory Inspector</h2>
        <button onClick={fetchMemories} style={{ padding: '0.5rem 1rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'white', borderRadius: '4px', cursor: 'pointer' }}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <form onSubmit={handleAdd} style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
        <input 
          type="text"
          value={newMemory}
          onChange={e => setNewMemory(e.target.value)}
          placeholder="Add a new fact manually..."
          style={{ flex: 1, padding: '0.8rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'white', borderRadius: '4px' }}
        />
        <button type="submit" style={{ padding: '0.8rem 1.5rem', background: 'var(--success)', color: 'var(--bg-base)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
          Add Memory
        </button>
      </form>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {memories.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No memories found for user '{userId}'.</p>
        ) : (
          memories.map(m => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <span>{m.memory}</span>
              <button onClick={() => handleDelete(m.id)} style={{ padding: '0.4rem 0.8rem', background: 'var(--danger)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
