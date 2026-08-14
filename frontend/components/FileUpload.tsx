/**
 * FileUpload.tsx
 *
 * Routing logic:
 *   PDF files  → /api/documents/upload (layout-aware pipeline: tables, images, text)
 *   Everything else → /api/ingest (existing Mem0 flat ingestion)
 *
 * PDFs show a richer result card: text / table / image_caption chunk counts.
 * Other files show the existing chunk count from Mem0.
 */
import React, { useState, useRef, useCallback } from 'react';
import { useAuth } from '../src/authContext';
import { ingestFile, uploadDocument, IngestResult, DocumentUploadResult } from '../src/api';

const ACCEPTED = '.pdf,.docx,.doc,.xlsx,.xls,.txt,.png,.jpg,.jpeg,.webp,.gif';

const EXT_META: Record<string, { icon: string; color: string; label: string }> = {
  pdf:  { icon: '📄', color: '#ef4444', label: 'PDF' },
  docx: { icon: '📝', color: '#3b82f6', label: 'Word' },
  doc:  { icon: '📝', color: '#3b82f6', label: 'Word' },
  xlsx: { icon: '📊', color: '#10b981', label: 'Excel' },
  xls:  { icon: '📊', color: '#10b981', label: 'Excel' },
  txt:  { icon: '📃', color: '#8b5cf6', label: 'Text' },
  png:  { icon: '🖼️', color: '#f59e0b', label: 'Image' },
  jpg:  { icon: '🖼️', color: '#f59e0b', label: 'Image' },
  jpeg: { icon: '🖼️', color: '#f59e0b', label: 'Image' },
  webp: { icon: '🖼️', color: '#f59e0b', label: 'Image' },
  gif:  { icon: '🖼️', color: '#f59e0b', label: 'Image' },
};

function getMeta(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_META[ext] ?? { icon: '📁', color: 'var(--accent-light)', label: 'File' };
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ── Entry type ────────────────────────────────────────────────────────────────
interface UploadEntry {
  name:     string;
  size:     number;
  isPdf:    boolean;
  status:   'uploading' | 'done' | 'error';
  progress: number;                          // 0-100, used for PDFs
  // PDF result
  docResult?:    DocumentUploadResult;
  // Non-PDF result
  ingestResult?: IngestResult;
  error?:        string;
}

// ── Chunk breakdown badge row (PDF only) ──────────────────────────────────────
function ChunkBreakdown({ r }: { r: DocumentUploadResult }) {
  const items = [
    { label: 'text',   val: r.chunks.text,          color: '#a78bfa' },
    { label: 'tables', val: r.chunks.table,         color: '#22d3ee' },
    { label: 'images', val: r.chunks.image_caption, color: '#f59e0b' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '4px', flexWrap: 'wrap' }}>
      {items.map(it => (
        <span key={it.label} style={{
          fontSize: '0.65rem', fontWeight: '600',
          padding: '1px 7px', borderRadius: '999px',
          background: `${it.color}18`, color: it.color,
          border: `1px solid ${it.color}30`,
        }}>
          {it.val} {it.label}
        </span>
      ))}
      <span style={{
        fontSize: '0.65rem', color: 'var(--text-muted)',
        alignSelf: 'center', marginLeft: '2px',
      }}>
        {r.pages} page{r.pages !== 1 ? 's' : ''}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function FileUpload() {
  const { accessToken } = useAuth();
  const [files, setFiles]     = useState<UploadEntry[]>([]);
  const [isDragging, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(async (incoming: FileList | File[]) => {
    if (!accessToken) return;
    const arr = Array.from(incoming);

    // Optimistically add all as uploading
    setFiles(prev => [
      ...arr.map(f => ({
        name: f.name, size: f.size,
        isPdf: f.name.toLowerCase().endsWith('.pdf'),
        status: 'uploading' as const,
        progress: 0,
      })),
      ...prev,
    ]);

    for (const file of arr) {
      const isPdf = file.name.toLowerCase().endsWith('.pdf');

      const setEntry = (patch: Partial<UploadEntry>) =>
        setFiles(prev => prev.map(u =>
          u.name === file.name && u.status !== 'done' && u.status !== 'error'
            ? { ...u, ...patch }
            : u
        ));

      try {
        if (isPdf) {
          // ── Layout-aware pipeline ─────────────────────────────────────────
          const result = await uploadDocument(
            accessToken,
            file,
            (pct) => setEntry({ progress: pct }),
          );
          setFiles(prev => prev.map(u =>
            u.name === file.name && u.status === 'uploading'
              ? { ...u, status: 'done', progress: 100, docResult: result }
              : u
          ));
        } else {
          // ── Flat Mem0 ingestion ───────────────────────────────────────────
          const result = await ingestFile(accessToken, file);
          setFiles(prev => prev.map(u =>
            u.name === file.name && u.status === 'uploading'
              ? { ...u, status: 'done', progress: 100, ingestResult: result }
              : u
          ));
        }
      } catch (err: any) {
        setFiles(prev => prev.map(u =>
          u.name === file.name && u.status === 'uploading'
            ? { ...u, status: 'error', error: err.message ?? 'Upload failed' }
            : u
        ));
      }
    }
  }, [accessToken]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '1.5rem 1.75rem 1.25rem', borderBottom: '1px solid var(--border)', background: 'rgba(13,15,24,0.9)', flexShrink: 0 }}>
        <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: '700', fontSize: '1.1rem', marginBottom: '2px' }}>
          📂 Documents
        </h2>
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          PDFs use layout-aware parsing — tables & images extracted separately
        </p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.75rem' }}>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${isDragging ? 'var(--accent-2)' : 'rgba(99,102,241,0.2)'}`,
            borderRadius: 'var(--r-xl)', padding: '2.5rem 1.5rem',
            textAlign: 'center', cursor: 'pointer',
            background: isDragging
              ? 'rgba(99,102,241,0.08)'
              : 'linear-gradient(145deg, rgba(99,102,241,0.04) 0%, rgba(34,211,238,0.02) 100%)',
            transition: 'all 0.2s var(--ease)',
            marginBottom: '1.25rem',
            boxShadow: isDragging ? '0 0 0 4px rgba(99,102,241,0.15)' : 'none',
          }}
        >
          <div style={{
            width: '52px', height: '52px', borderRadius: '16px', margin: '0 auto 1rem',
            background: 'linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(34,211,238,0.1) 100%)',
            border: '1px solid rgba(99,102,241,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem',
            boxShadow: '0 4px 16px rgba(99,102,241,0.2)',
          }}>📥</div>
          <p style={{ fontWeight: '600', fontSize: '0.9rem', marginBottom: '0.35rem' }}>
            {isDragging ? 'Drop to upload' : 'Drag & drop files here'}
          </p>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            PDF · Word · Excel · Images · TXT — Max 50MB
          </p>
          <span style={{
            display: 'inline-block', padding: '0.4rem 1.1rem',
            background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)',
            borderRadius: '999px', fontSize: '0.78rem', color: 'var(--accent-light)', fontWeight: '500',
          }}>Browse Files</span>
          <input ref={inputRef} type="file" multiple accept={ACCEPTED}
            onChange={e => { if (e.target.files?.length) processFiles(e.target.files); e.target.value = ''; }}
            style={{ display: 'none' }} />
        </div>

        {/* Pipeline legend */}
        <div style={{
          display: 'flex', gap: '0.5rem', marginBottom: '1.25rem',
          padding: '0.65rem 0.85rem', borderRadius: 'var(--r-md)',
          background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.12)',
        }}>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
            <span style={{ color: '#ef4444', fontWeight: '600' }}>PDF</span>
            {' → layout-aware (tables + images + text)  ·  '}
            <span style={{ color: 'var(--accent-light)', fontWeight: '600' }}>Other</span>
            {' → flat memory ingestion'}
          </span>
        </div>

        {/* Type pills */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          {[
            { icon: '📄', label: 'PDF', color: '#ef4444', tip: 'Smart' },
            { icon: '📝', label: 'Word', color: '#3b82f6', tip: '' },
            { icon: '📊', label: 'Excel', color: '#10b981', tip: '' },
            { icon: '🖼️', label: 'Images', color: '#f59e0b', tip: '' },
            { icon: '📃', label: 'TXT', color: '#8b5cf6', tip: '' },
          ].map(t => (
            <span key={t.label} style={{
              display: 'flex', alignItems: 'center', gap: '0.3rem',
              padding: '3px 10px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: '500',
              background: `${t.color}15`, color: t.color, border: `1px solid ${t.color}25`,
            }}>
              {t.icon} {t.label}
              {t.tip && <span style={{ fontSize: '0.58rem', opacity: 0.7 }}>✦ {t.tip}</span>}
            </span>
          ))}
        </div>

        {/* File list */}
        {files.length > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: '500' }}>
                {files.filter(f => f.status === 'done').length}/{files.length} processed
              </span>
              <button onClick={() => setFiles([])}
                style={{ fontSize: '0.72rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                Clear all
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              {files.map((f, i) => {
                const meta = getMeta(f.name);
                return (
                  <div key={i} className="card-3d" style={{ borderRadius: 'var(--r-md)', padding: '0.75rem', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>

                      {/* Icon */}
                      <div style={{
                        width: '36px', height: '36px', borderRadius: '10px', flexShrink: 0,
                        background: `${meta.color}15`, border: `1px solid ${meta.color}30`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
                      }}>{meta.icon}</div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Name */}
                        <div style={{ fontSize: '0.82rem', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                          {f.name}
                        </div>
                        {/* Size + type */}
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {formatSize(f.size)} · {meta.label}
                          {f.isPdf && <span style={{ marginLeft: '6px', color: 'rgba(99,102,241,0.7)', fontSize: '0.62rem' }}>✦ smart pipeline</span>}
                        </div>

                        {/* Status messages */}
                        {f.status === 'uploading' && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--accent-cyan)', marginTop: '3px' }} className="pulsing">
                            ⏳ {f.isPdf ? `Parsing… ${f.progress > 0 ? f.progress + '%' : ''}` : 'Processing…'}
                          </div>
                        )}
                        {f.status === 'error' && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--danger)', marginTop: '3px' }}>❌ {f.error}</div>
                        )}
                        {f.status === 'done' && f.docResult && (
                          <>
                            <div style={{ fontSize: '0.7rem', color: 'var(--success)', marginTop: '3px' }}>
                              ✅ {f.docResult.chunks.total} chunks stored · layout-aware
                            </div>
                            <ChunkBreakdown r={f.docResult} />
                          </>
                        )}
                        {f.status === 'done' && f.ingestResult && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--success)', marginTop: '3px' }}>
                            ✅ {f.ingestResult.chunks_stored} chunk{f.ingestResult.chunks_stored !== 1 ? 's' : ''} stored in memory
                          </div>
                        )}
                      </div>

                      {/* Status dot */}
                      <div style={{
                        width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, marginTop: '5px',
                        background: f.status === 'done' ? 'var(--success)' : f.status === 'error' ? 'var(--danger)' : 'var(--accent-cyan)',
                        boxShadow: f.status === 'uploading' ? '0 0 6px var(--accent-cyan)' : 'none',
                        animation: f.status === 'uploading' ? 'pulsing 1s ease-in-out infinite' : 'none',
                      }} />
                    </div>

                    {/* Progress bar for PDF uploads */}
                    {f.isPdf && f.status === 'uploading' && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <div className="progress-track">
                          <div className="progress-fill" style={{ width: `${f.progress || 5}%`, transition: 'width 0.3s ease' }} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
