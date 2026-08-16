import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAuth } from '../src/authContext';
import { ingestFile, uploadDocument, deleteDocument, clearImageMemories, listDocuments, StoredDocument, IngestResult, DocumentUploadResult } from '../src/api';

const ACCEPTED = '.pdf,.docx,.doc,.xlsx,.xls,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.gif,.mp3,.wav,.m4a,.mp4,.mov';

const EXT_ICON: Record<string, string> = {
  pdf: '📄', docx: '📝', doc: '📝', xlsx: '📊', xls: '📊',
  txt: '📃', md: '📃', csv: '📃',
  png: '🖼️', jpg: '🖼️', jpeg: '🖼️', webp: '🖼️', gif: '🖼️',
  mp3: '🎵', wav: '🎵', m4a: '🎵', mp4: '🎬', mov: '🎬',
};

// These file types are silently ingested into memory — not shown in Documents panel
const SILENT_EXTS = new Set(['png','jpg','jpeg','webp','gif','bmp','mp3','wav','m4a','ogg','mp4','mov','avi']);

function getIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_ICON[ext] ?? '📁';
}

function formatBytes(n: number) {
  if (n < 1024) return `${n}B`;
  if (n < 1048576) return `${(n/1024).toFixed(0)}KB`;
  return `${(n/1048576).toFixed(1)}MB`;
}

function formatDate(iso: string) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

interface UploadEntry {
  name: string; size: number; isPdf: boolean;
  status: 'uploading' | 'done' | 'error';
  progress: number;
  docResult?: DocumentUploadResult;
  ingestResult?: IngestResult;
  error?: string;
}

// ── Stored document card ──────────────────────────────────────────────────────
function DocCard({ doc, onDelete }: { doc: StoredDocument; onDelete: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const { accessToken } = useAuth();

  const handleDelete = async () => {
    if (!accessToken) return;
    setDeleting(true);
    try {
      await deleteDocument(accessToken, doc.document_id);
      onDelete();
    } catch (e) {
      setDeleting(false);
    }
  };

  return (
    <div className="card-3d" style={{ borderRadius: 'var(--r-md)', padding: '0.85rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start', animation: 'fadeUp 0.2s var(--ease)' }}>
      <div style={{ fontSize: '1.4rem', flexShrink: 0, width: '36px', textAlign: 'center' }}>
        {getIcon(doc.filename)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.83rem', fontWeight: '600', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '0.25rem' }}>
          {doc.filename}
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
          {[
            { val: doc.text_count,  label: 'text',   color: 'var(--accent-light)' },
            { val: doc.table_count, label: 'tables', color: 'var(--accent-cyan)' },
            { val: doc.image_count, label: 'images', color: 'var(--warning)' },
          ].filter(s => s.val > 0).map(s => (
            <span key={s.label} style={{ fontSize: '0.62rem', padding: '1px 7px', borderRadius: '999px', background: `${s.color}15`, color: s.color, border: `1px solid ${s.color}25` }}>
              {s.val} {s.label}
            </span>
          ))}
        </div>
        {doc.uploaded_at && (
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
            🕐 {formatDate(doc.uploaded_at)}
          </div>
        )}
      </div>
      <button
        onClick={handleDelete}
        disabled={deleting}
        style={{ background: 'none', border: 'none', cursor: deleting ? 'not-allowed' : 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '2px 4px', borderRadius: '4px', transition: 'color var(--dur-fast)', flexShrink: 0 }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
      >{deleting ? '⏳' : '🗑️'}</button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function FileUpload() {
  const { accessToken } = useAuth();
  const [storedDocs, setStoredDocs]   = useState<StoredDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [uploads, setUploads]         = useState<UploadEntry[]>([]);
  const [isDragging, setDragging]     = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Load stored documents ─────────────────────────────────────────────────
  const loadDocs = useCallback(async () => {
    if (!accessToken) return;
    setDocsLoading(true);
    try { setStoredDocs(await listDocuments(accessToken)); }
    catch (e) { console.error(e); }
    finally { setDocsLoading(false); }
  }, [accessToken]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  // ── Upload handler ────────────────────────────────────────────────────────
  const processFiles = useCallback(async (files: FileList | File[]) => {
    if (!accessToken) return;
    const arr = Array.from(files);
    setUploads(prev => [
      // Only add non-silent files to the upload progress list
      ...arr
        .filter(f => !SILENT_EXTS.has(f.name.split('.').pop()?.toLowerCase() ?? ''))
        .map(f => ({ name: f.name, size: f.size, isPdf: f.name.toLowerCase().endsWith('.pdf'), status: 'uploading' as const, progress: 0 })),
      ...prev,
    ]);

    for (const file of arr) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const isSilent = SILENT_EXTS.has(ext);
      const isPdf = file.name.toLowerCase().endsWith('.pdf');
      const patch = (p: Partial<UploadEntry>) =>
        setUploads(prev => prev.map(u => u.name === file.name && u.status === 'uploading' ? { ...u, ...p } : u));

      try {
        if (isSilent) {
          // Silently ingest images/audio/video — stored in memory, never shown in Documents
          await ingestFile(accessToken, file);
          // No UI update — file is stored but not displayed
        } else if (isPdf) {
          const r = await uploadDocument(accessToken, file, pct => patch({ progress: pct }));
          patch({ status: 'done', progress: 100, docResult: r });
        } else {
          const r = await ingestFile(accessToken, file);
          patch({ status: 'done', progress: 100, ingestResult: r });
        }
        await loadDocs(); // refresh stored docs list
      } catch (err: any) {
        if (!isSilent) patch({ status: 'error', error: err.message ?? 'Upload failed' });
      }
    }
  }, [accessToken, loadDocs]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '1.5rem 1.75rem 1.25rem', borderBottom: '1px solid var(--border)', background: 'rgba(13,15,24,0.9)', flexShrink: 0 }}>
        <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: '700', fontSize: '1.1rem', marginBottom: '2px' }}>📂 Documents</h2>
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>PDFs use layout-aware parsing — tables &amp; images extracted separately</p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.75rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* ── Stored Documents (always visible) ── */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-secondary)' }}>
              🗂 Stored Documents {storedDocs.length > 0 && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>({storedDocs.length})</span>}
            </span>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              <button
                onClick={async () => {
                  if (!accessToken) return;
                  try {
                    await clearImageMemories(accessToken);
                    await loadDocs();
                  } catch (e) {}
                }}
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--r-sm)', padding: '2px 8px', cursor: 'pointer', color: 'var(--danger)', fontSize: '0.72rem', fontFamily: 'var(--font-body)', fontWeight: '500' }}
                title="Clear all stored image memories"
              >
                🗑️ Clear Images
              </button>
              <button
                onClick={loadDocs}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.78rem', fontFamily: 'var(--font-body)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--accent-light)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                <span className={docsLoading ? 'pulsing' : ''}>⟳</span> Refresh
              </button>
            </div>
          </div>

          {docsLoading ? (
            <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)', fontSize: '0.82rem' }} className="pulsing">Loading documents...</div>
          ) : storedDocs.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '1.5rem', borderRadius: 'var(--r-lg)',
              background: 'rgba(255,255,255,0.02)', border: '1px dashed var(--border)',
              color: 'var(--text-muted)', fontSize: '0.82rem',
            }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.3 }}>📂</div>
              No documents uploaded yet. Use the upload zone below.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              {storedDocs.map(doc => (
                <DocCard key={doc.document_id} doc={doc} onDelete={loadDocs} />
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="divider" />

        {/* ── Upload zone ── */}
        <div>
          <div style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.65rem' }}>
            ⬆ Upload New
          </div>

          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${isDragging ? 'var(--accent-2)' : 'rgba(99,102,241,0.2)'}`,
              borderRadius: 'var(--r-xl)', padding: '2rem 1.5rem',
              textAlign: 'center', cursor: 'pointer',
              background: isDragging ? 'rgba(99,102,241,0.08)' : 'linear-gradient(145deg, rgba(99,102,241,0.04) 0%, rgba(34,211,238,0.02) 100%)',
              transition: 'all 0.2s var(--ease)',
              boxShadow: isDragging ? '0 0 0 4px rgba(99,102,241,0.15)' : 'none',
              marginBottom: '0.75rem',
            }}
          >
            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>📥</div>
            <p style={{ fontWeight: '600', fontSize: '0.88rem', marginBottom: '0.25rem' }}>
              {isDragging ? 'Drop to upload' : 'Drag & drop or click to browse'}
            </p>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              PDF · Word · Excel · TXT — shown in Documents list<br />
              <span style={{ opacity: 0.6 }}>Images / Audio / Video — stored silently in memory</span>
            </p>
            <input ref={fileInputRef} type="file" multiple accept={ACCEPTED}
              onChange={e => { if (e.target.files?.length) processFiles(e.target.files); e.target.value = ''; }}
              style={{ display: 'none' }} />
          </div>

          {/* Pipeline info */}
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', padding: '0.4rem 0.75rem', borderRadius: 'var(--r-sm)', background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.12)' }}>
            <span style={{ color: '#ef4444', fontWeight: '600' }}>PDF</span> → layout-aware (LlamaParse) · <span style={{ color: 'var(--accent-light)', fontWeight: '600' }}>Other</span> → fast local ingest
          </div>

          {/* Current upload progress */}
          {uploads.length > 0 && (
            <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {uploads.filter(u => u.status === 'done').length}/{uploads.length} processed
                </span>
                <button onClick={() => setUploads([])} style={{ fontSize: '0.72rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                  Clear
                </button>
              </div>
              {uploads.map((u, i) => (
                <div key={i} className="card-3d" style={{ borderRadius: 'var(--r-md)', padding: '0.7rem', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{getIcon(u.name)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{formatBytes(u.size)}{u.isPdf && <span style={{ marginLeft: '6px', color: 'rgba(99,102,241,0.7)' }}>✦ smart pipeline</span>}</div>
                      {u.status === 'uploading' && <div style={{ fontSize: '0.68rem', color: 'var(--accent-cyan)' }} className="pulsing">⏳ {u.isPdf ? `Parsing… ${u.progress}%` : 'Processing…'}</div>}
                      {u.status === 'error'    && <div style={{ fontSize: '0.68rem', color: 'var(--danger)' }}>❌ {u.error}</div>}
                      {u.status === 'done' && u.docResult && <div style={{ fontSize: '0.68rem', color: 'var(--success)' }}>✅ {u.docResult.chunks.total} chunks — {u.docResult.chunks.text} text · {u.docResult.chunks.table} tables · {u.docResult.chunks.image_caption} images</div>}
                      {u.status === 'done' && u.ingestResult && <div style={{ fontSize: '0.68rem', color: 'var(--success)' }}>✅ {u.ingestResult.chunks_stored} chunk(s) stored</div>}
                    </div>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, marginTop: '4px', background: u.status === 'done' ? 'var(--success)' : u.status === 'error' ? 'var(--danger)' : 'var(--accent-cyan)', animation: u.status === 'uploading' ? 'pulsing 1s infinite' : 'none' }} />
                  </div>
                  {u.isPdf && u.status === 'uploading' && (
                    <div className="progress-track" style={{ marginTop: '0.45rem' }}>
                      <div className="progress-fill" style={{ width: `${Math.max(u.progress, 5)}%`, transition: 'width 0.3s ease' }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
