/**
 * Analytics.tsx — Phase 2.3 dashboard
 * Shows: memory growth, documents ingested, task completion, conversation activity
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../src/authContext';
import { getAnalytics, analyseDocument, AnalyticsData, AnalysisCard } from '../src/api';

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, color }: {
  icon: string; label: string; value: number | string; sub?: string; color: string;
}) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${color}25`,
      borderRadius: 'var(--r-lg)',
      padding: '1.1rem',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: '-10px', right: '-10px', fontSize: '3rem', opacity: 0.07 }}>{icon}</div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>{label}</div>
      <div style={{ fontSize: '1.8rem', fontWeight: '700', fontFamily: 'var(--font-mono)', color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>{sub}</div>}
    </div>
  );
}

// ── Mini bar chart ────────────────────────────────────────────────────────────
function ActivityChart({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: '600', marginBottom: '0.75rem' }}>
        Messages sent — last 7 days
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '80px' }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <div style={{
              width: '100%',
              height: `${Math.max((d.count / max) * 70, d.count > 0 ? 4 : 0)}px`,
              background: d.count > 0
                ? 'linear-gradient(180deg, #6366f1 0%, #8b5cf6 100%)'
                : 'rgba(255,255,255,0.06)',
              borderRadius: '3px 3px 0 0',
              transition: 'height 0.4s ease',
              boxShadow: d.count > 0 ? '0 0 8px rgba(99,102,241,0.3)' : 'none',
            }} />
            <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{d.date}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Analysis card renderer ────────────────────────────────────────────────────
function AnalysisResult({ card }: { card: AnalysisCard }) {
  const [showTable, setShowTable] = useState<number | null>(null);
  return (
    <div style={{
      background: 'linear-gradient(145deg, rgba(99,102,241,0.08) 0%, rgba(34,211,238,0.04) 100%)',
      border: '1px solid rgba(99,102,241,0.2)',
      borderRadius: 'var(--r-xl)',
      padding: '1.25rem',
      animation: 'fadeUp 0.3s var(--ease)',
    }}>
      <div style={{ fontFamily: 'var(--font-head)', fontWeight: '700', fontSize: '1rem', marginBottom: '0.5rem', color: 'var(--accent-light)' }}>
        📊 {card.title}
      </div>
      <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1rem' }}>{card.summary}</p>

      {/* Key facts */}
      {card.key_facts.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>Key Facts</div>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {card.key_facts.map((f, i) => (
              <li key={i} style={{ fontSize: '0.8rem', color: 'var(--text-primary)', display: 'flex', gap: '0.5rem' }}>
                <span style={{ color: 'var(--accent-cyan)', flexShrink: 0 }}>→</span>{f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tables */}
      {card.tables.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
            Tables ({card.tables.length})
          </div>
          {card.tables.map((t, i) => (
            <div key={i} style={{ marginBottom: '0.5rem' }}>
              <button
                onClick={() => setShowTable(showTable === i ? null : i)}
                style={{
                  background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)',
                  borderRadius: 'var(--r-sm)', padding: '0.35rem 0.75rem',
                  color: 'var(--accent-light)', cursor: 'pointer', fontSize: '0.78rem',
                  fontFamily: 'var(--font-body)', width: '100%', textAlign: 'left',
                  display: 'flex', justifyContent: 'space-between',
                }}
              >
                <span>📋 {t.caption} (p{t.page})</span>
                <span>{showTable === i ? '▲' : '▼'}</span>
              </button>
              {showTable === i && (
                <div style={{
                  marginTop: '0.4rem', overflowX: 'auto',
                  background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--r-sm)',
                  padding: '0.75rem', fontSize: '0.72rem',
                  fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
                  whiteSpace: 'pre',
                }}>
                  {t.markdown}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Figures */}
      {card.figures.length > 0 && (
        <div>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
            Figures ({card.figures.length})
          </div>
          {card.figures.map((f, i) => (
            <div key={i} style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
              <span style={{ color: 'var(--warning)' }}>🖼 p{f.page}</span> — {f.description}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Analytics() {
  const { accessToken } = useAuth();
  const [data, setData]         = useState<AnalyticsData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [analyseQ, setAnalyseQ] = useState('');
  const [analysing, setAnalysing] = useState(false);
  const [card, setCard]         = useState<AnalysisCard | null>(null);
  const [analyseErr, setAnalyseErr] = useState('');

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try { setData(await getAnalytics(accessToken)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  const handleAnalyse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!analyseQ.trim() || !accessToken) return;
    setAnalysing(true); setCard(null); setAnalyseErr('');
    try {
      const result = await analyseDocument(accessToken, analyseQ);
      setCard(result);
    } catch (err: any) {
      setAnalyseErr(err.message);
    } finally {
      setAnalysing(false);
    }
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
      <span className="pulsing">Loading analytics...</span>
    </div>
  );

  const d = data!;
  const taskPct = d.total_tasks > 0 ? Math.round((d.done_tasks / d.total_tasks) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', background: 'var(--bg-base)' }}>

      {/* Header */}
      <div style={{ padding: '1.5rem 1.75rem 1.25rem', borderBottom: '1px solid var(--border)', background: 'rgba(13,15,24,0.9)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: '700', fontSize: '1.1rem', marginBottom: '2px' }}>📈 Analytics</h2>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Your AI assistant usage overview</p>
          </div>
          <button onClick={load} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '0.4rem 0.9rem', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'var(--font-body)' }}>
            ⟳ Refresh
          </button>
        </div>
      </div>

      <div style={{ flex: 1, padding: '1.25rem 1.75rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* Stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
          <StatCard icon="🧠" label="Memories"       value={d.total_memories}  sub={`+${d.memories_this_week} this week`} color="var(--accent-light)" />
          <StatCard icon="📂" label="Documents"      value={d.total_documents} sub={`${d.total_doc_chunks} chunks total`}  color="var(--accent-cyan)" />
          <StatCard icon="📋" label="Tasks"          value={d.total_tasks}     sub={`${taskPct}% completed`}               color="var(--warning)" />
          <StatCard icon="💬" label="Conversations"  value={d.total_sessions}  sub={`${d.total_messages} messages`}        color="var(--success)" />
        </div>

        {/* Document breakdown */}
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '1rem' }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: '600', marginBottom: '0.75rem' }}>Document chunks breakdown</div>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Text',   val: d.total_doc_chunks - d.table_chunks - d.image_chunks, color: 'var(--accent-light)' },
              { label: 'Tables', val: d.table_chunks,  color: 'var(--accent-cyan)' },
              { label: 'Images', val: d.image_chunks,  color: 'var(--warning)' },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: item.color }} />
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{item.label}</span>
                <span style={{ fontSize: '0.78rem', fontWeight: '700', color: item.color, fontFamily: 'var(--font-mono)' }}>{item.val}</span>
              </div>
            ))}
          </div>
          {/* Progress bar */}
          {d.total_doc_chunks > 0 && (
            <div style={{ marginTop: '0.75rem', height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden', display: 'flex' }}>
              {[
                { val: d.total_doc_chunks - d.table_chunks - d.image_chunks, color: 'var(--accent-light)' },
                { val: d.table_chunks,  color: 'var(--accent-cyan)' },
                { val: d.image_chunks,  color: 'var(--warning)' },
              ].map((s, i) => (
                <div key={i} style={{ width: `${(s.val / d.total_doc_chunks) * 100}%`, background: s.color, transition: 'width 0.5s ease' }} />
              ))}
            </div>
          )}
        </div>

        {/* Task progress */}
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: '600' }}>Task completion</span>
            <span style={{ fontSize: '0.78rem', color: 'var(--success)', fontWeight: '700', fontFamily: 'var(--font-mono)' }}>{taskPct}%</span>
          </div>
          <div className="progress-track" style={{ height: '8px' }}>
            <div className="progress-fill" style={{ width: `${taskPct}%` }} />
          </div>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
            {[
              { label: 'Done', val: d.done_tasks, color: 'var(--success)' },
              { label: 'Pending', val: d.pending_tasks, color: 'var(--warning)' },
            ].map(s => (
              <span key={s.label} style={{ fontSize: '0.72rem', color: s.color }}>
                {s.val} {s.label}
              </span>
            ))}
          </div>
        </div>

        {/* Activity chart */}
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '1rem' }}>
          <ActivityChart data={d.recent_activity} />
        </div>

        {/* Document analysis (Phase 2.2) */}
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '1rem' }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: '600', marginBottom: '0.75rem' }}>
            🔍 Analyse an uploaded document
          </div>
          <form onSubmit={handleAnalyse} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <input
              value={analyseQ}
              onChange={e => setAnalyseQ(e.target.value)}
              placeholder="e.g. carbon emissions, invoice, Q3 report..."
              className="input-glass"
              style={{ flex: 1, padding: '0.6rem 0.9rem', fontSize: '0.85rem' }}
            />
            <button
              type="submit"
              disabled={analysing || !analyseQ.trim()}
              className="btn-primary"
              style={{ padding: '0.6rem 1.1rem', fontSize: '0.82rem', fontWeight: '600', borderRadius: 'var(--r-lg)', opacity: analysing ? 0.6 : 1 }}
            >
              {analysing ? <span className="pulsing">⏳</span> : 'Analyse'}
            </button>
          </form>
          {analyseErr && <p style={{ fontSize: '0.78rem', color: 'var(--danger)', marginBottom: '0.5rem' }}>❌ {analyseErr}</p>}
          {card && <AnalysisResult card={card} />}
        </div>

      </div>
    </div>
  );
}
