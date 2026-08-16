import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../src/authContext';
import { sendChatMessage, generateImage, ingestFile, uploadDocument } from '../src/api';

type MessageRole = 'user' | 'assistant' | 'system';
interface Message { id: number; role: MessageRole; content: string; imageUrl?: string; files?: { name: string; size: number }[]; }

// Staged file — picked but not yet uploaded
interface StagedFile { file: File; id: number; }

declare global {
  interface Window { SpeechRecognition: any; webkitSpeechRecognition: any; }
}

interface Props {
  onRegisterLoader?: (fn: (msgs: { role: string; content: string }[]) => void) => void;
}

const IMAGE_TRIGGERS = [
  /^\/image\s+(.+)/i,
  /^generate(?:\s+an?)?\s+image\s+(?:of\s+)?(.+)/i,
  /^create(?:\s+an?)?\s+image\s+(?:of\s+)?(.+)/i,
  /^draw(?:\s+an?)?\s+(?:image\s+(?:of\s+)?)?(.+)/i,
  /^show\s+(?:me\s+)?(?:an?\s+)?image\s+(?:of\s+)?(.+)/i,
  /^make(?:\s+an?)?\s+image\s+(?:of\s+)?(.+)/i,
];
function detectImageRequest(text: string) {
  for (const p of IMAGE_TRIGGERS) { const m = text.trim().match(p); if (m) return m[1].trim(); }
  return null;
}

function pickUSFemaleVoice(voices: SpeechSynthesisVoice[]) {
  const names = ['zira','samantha','aria','jenny','michelle','sonia','ana','monica'];
  return voices.find(v => v.lang.startsWith('en-US') && names.some(n => v.name.toLowerCase().includes(n)))
    ?? voices.find(v => v.lang.startsWith('en-US'))
    ?? voices[0] ?? null;
}

function speak(text: string, voice: SpeechSynthesisVoice | null, onStart?: () => void, onEnd?: () => void) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const clean = text.replace(/\*\*(.*?)\*\*/g,'$1').replace(/\*(.*?)\*/g,'$1')
    .replace(/`[^`]+`/g,'').replace(/#{1,6}\s/g,'').substring(0, 500);
  const u = new SpeechSynthesisUtterance(clean);
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? 'en-US'; u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;
  u.onstart = () => onStart?.();
  u.onend   = () => onEnd?.();
  u.onerror = () => onEnd?.();
  window.speechSynthesis.speak(u);
}

function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string,string> = {
    pdf:'📄', docx:'📝', doc:'📝', xlsx:'📊', xls:'📊',
    txt:'📃', csv:'📃', md:'📃',
    png:'🖼️', jpg:'🖼️', jpeg:'🖼️', webp:'🖼️', gif:'🖼️',
    mp3:'🎵', wav:'🎵', m4a:'🎵', mp4:'🎬', mov:'🎬',
  };
  return map[ext] ?? '📁';
}

function formatBytes(n: number) {
  if (n < 1024) return `${n}B`;
  if (n < 1048576) return `${(n/1024).toFixed(0)}KB`;
  return `${(n/1048576).toFixed(1)}MB`;
}

let msgId = 0;
let fileIdCounter = 0;

export default function ChatWindow({ onRegisterLoader }: Props) {
  const { accessToken } = useAuth();
  const [messages, setMessages]         = useState<Message[]>([]);
  const [input, setInput]               = useState('');
  const [stagedFiles, setStagedFiles]   = useState<StagedFile[]>([]);   // ← staged, not uploaded
  const [isCrew, setIsCrew]             = useState(false);
  const [isLoading, setIsLoading]       = useState(false);
  const [isSpeaking, setIsSpeaking]     = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [isListening, setIsListening]   = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [speechOk, setSpeechOk]         = useState(false);
  const [selectedVoice, setVoice]       = useState<SpeechSynthesisVoice | null>(null);
  const [showAttach, setShowAttach]     = useState(false);
  const [sessionId, setSessionId]       = useState<string | null>(null);
  // Last uploaded file names — used to auto-include file context in the next chat message
  const [lastUploadedFiles, setLastUploadedFiles] = useState<string[]>([]);
  // Phase 4 — text-selection popup
  const [selectionPopup, setSelectionPopup] = useState<{ x: number; y: number; text: string } | null>(null);

  const scrollRef   = useRef<HTMLDivElement>(null);
  const recogRef    = useRef<any>(null);
  const attachRef   = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);  // single input for all types

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    setSpeechOk(!!(window.SpeechRecognition || window.webkitSpeechRecognition));
    const load = () => { const v = window.speechSynthesis.getVoices(); if (v.length) setVoice(pickUSFemaleVoice(v)); };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  useEffect(() => {
    if (!onRegisterLoader) return;
    onRegisterLoader(msgs => {
      msgId = 0; setSessionId(null);
      setMessages(msgs.map(m => { msgId++; return { id: msgId, role: m.role as MessageRole, content: m.content }; }));
    });
  }, [onRegisterLoader]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (attachRef.current && !attachRef.current.contains(e.target as Node)) setShowAttach(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // ── Phase 4: text-selection popup ────────────────────────────────────────
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      // Only trigger inside the messages scroll container
      if (!scrollRef.current?.contains(e.target as Node)) return;
      setTimeout(() => {
        const sel = window.getSelection();
        const selected = sel?.toString().trim() ?? '';
        if (selected.length > 10 && sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          const rect  = range.getBoundingClientRect();
          const containerRect = scrollRef.current!.getBoundingClientRect();
          setSelectionPopup({
            x: rect.left - containerRect.left + rect.width / 2,
            y: rect.top  - containerRect.top  - 44,   // 44px above selection
            text: selected.slice(0, 300),
          });
        } else {
          setSelectionPopup(null);
        }
      }, 10);
    };
    const handleMouseDown = (e: MouseEvent) => {
      // Dismiss popup unless clicking the popup button itself
      const popup = document.getElementById('ask-about-popup');
      if (popup && popup.contains(e.target as Node)) return;
      setSelectionPopup(null);
    };
    document.addEventListener('mouseup',   handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('mouseup',   handleMouseUp);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);


  // ── Helpers ───────────────────────────────────────────────────────────────
  const addMsg = useCallback((role: MessageRole, content: string, imageUrl?: string) => {
    msgId++; setMessages(p => [...p, { id: msgId, role, content, imageUrl }]); return msgId;
  }, []);

  // ── Stop generation ───────────────────────────────────────────────────────
  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setIsLoading(false);
    addMsg('system', '⏹ Response stopped.');
  }, [addMsg]);

  // ── Stop audio ─────────────────────────────────────────────────────────────
  const stopAudio = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  }, []);
  const stageFiles = useCallback((files: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files);
    if (!arr.length) return;
    setShowAttach(false);
    const incoming: StagedFile[] = arr.map(file => {
      fileIdCounter++;
      return { file, id: fileIdCounter };
    });
    setStagedFiles(prev => [...prev, ...incoming]);
  }, []);

  const removeStagedFile = useCallback((id: number) => {
    setStagedFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  // ── Main send — handles text, files, or both ──────────────────────────────
  const handleSend = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    const currentFiles = [...stagedFiles];
    const hasText  = text.length > 0;
    const hasFiles = currentFiles.length > 0;

    if (!hasText && !hasFiles) return;
    if (!accessToken) return;

    // Clear input + staged files immediately
    setInput('');
    setStagedFiles([]);
    setIsLoading(true);

    try {
      // ── Upload staged files first ────────────────────────────────────────
      for (const sf of currentFiles) {
        const uid = (() => { msgId++; return msgId; })();
        // Add the user message with a files chip that persists in history
        setMessages(p => [...p, {
          id: uid, role: 'user', content: '',
          files: [{ name: sf.file.name, size: sf.file.size }],
        }]);

        const uploadingId = (() => { msgId++; return msgId; })();
        const isPdf = sf.file.name.toLowerCase().endsWith('.pdf');
        setMessages(p => [...p, { id: uploadingId, role: 'system', content: `⏳ ${isPdf ? 'Parsing PDF (tables, images, text)…' : `Uploading "${sf.file.name}"…`}` }]);

        try {
          if (isPdf) {
            // Full LlamaParse pipeline — extracts tables, images, structured text
            const r = await uploadDocument(accessToken, sf.file, (pct) => {
              setMessages(p => p.map(m =>
                m.id === uploadingId ? { ...m, content: `⏳ Parsing PDF… ${pct}%` } : m
              ));
            });
            setMessages(p => p.map(m =>
              m.id === uploadingId
                ? { ...m, content: `✅ "${r.filename}" fully parsed — ${r.chunks.text} text · ${r.chunks.table} table${r.chunks.table !== 1 ? 's' : ''} · ${r.chunks.image_caption} image${r.chunks.image_caption !== 1 ? 's' : ''} stored` }
                : m
            ));
          } else {
            // All other file types — fast local ingest
            const r = await ingestFile(accessToken, sf.file);
            setMessages(p => p.map(m =>
              m.id === uploadingId
                ? { ...m, content: `✅ "${r.filename}" stored — ${r.chunks_stored} chunk(s) saved to memory` }
                : m
            ));
          }
        } catch (err: any) {
          setMessages(p => p.map(m =>
            m.id === uploadingId
              ? { ...m, content: `❌ Failed to upload "${sf.file.name}": ${err.message}` }
              : m
          ));
        }
        // Track uploaded file names for context injection in next message
        setLastUploadedFiles(currentFiles.map(sf => sf.file.name));
      }

      // ── Send text message (if any) ────────────────────────────────────────
      if (hasText) {
        const imgPrompt = detectImageRequest(text);
        addMsg('user', text);

        if (imgPrompt) {
          addMsg('system', `🎨 Generating "${imgPrompt}"...`);
          const r = await generateImage(accessToken, imgPrompt);
          msgId++;
          setMessages(p => [
            ...p.filter(m => m.role !== 'system'),
            { id: msgId, role: 'assistant', content: `Here's your image: **${imgPrompt}**`, imageUrl: r.url },
          ]);
          if (voiceEnabled) speak(`Here's your image of ${imgPrompt}`, selectedVoice, () => setIsSpeaking(true), () => setIsSpeaking(false));
        } else {
          // Use AbortController so user can cancel mid-request
          const controller = new AbortController();
          abortRef.current = controller;
          // Include file context: files staged now, OR files just uploaded in this turn
          const fileContext = currentFiles.length > 0
            ? currentFiles.map(sf => sf.file.name)
            : lastUploadedFiles;
          const queryPayload = fileContext.length > 0
            ? `${fileContext.join(' ')} ${text}`
            : text;
          // Clear last uploaded context after using it
          if (lastUploadedFiles.length > 0) setLastUploadedFiles([]);
          const r = await sendChatMessage(accessToken, queryPayload, isCrew, sessionId);
          abortRef.current = null;
          addMsg('assistant', r.reply);
          if (r.session_id) setSessionId(r.session_id);
          if (voiceEnabled) speak(r.reply, selectedVoice, () => setIsSpeaking(true), () => setIsSpeaking(false));
        }
      } else if (hasFiles) {
        // Files only — confirm upload with a brief assistant reply
        addMsg('assistant', `✅ ${stagedFiles.length === 1 ? `"${stagedFiles[0].file.name}" has` : `${stagedFiles.length} files have`} been saved to memory. You can now ask me anything about ${stagedFiles.length === 1 ? 'it' : 'them'}.`);
      }

    } catch (err: any) {
      addMsg('assistant', `⚠️ ${err.message ?? 'Something went wrong.'}`);
    } finally {
      setIsLoading(false);
    }
  }, [input, stagedFiles, accessToken, isCrew, voiceEnabled, selectedVoice, sessionId, addMsg]);

  // ── Voice input ───────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    recogRef.current = r;
    r.lang = 'en-US'; r.continuous = false; r.interimResults = false;
    r.onstart = () => setIsListening(true);
    r.onend   = () => setIsListening(false);
    r.onerror = () => setIsListening(false);
    r.onresult = (e: any) => { const t = e.results[0][0].transcript; setInput(t); handleSend(t); };
    r.start();
  }, [handleSend]);
  const stopListening = useCallback(() => { recogRef.current?.stop(); setIsListening(false); }, []);

  // ── Can send? ─────────────────────────────────────────────────────────────
  const canSend = (input.trim().length > 0 || stagedFiles.length > 0) && !isLoading;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)' }}>

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        padding: '0.6rem 1.25rem', gap: '0.75rem',
        borderBottom: '1px solid var(--border)',
        background: 'rgba(13,15,24,0.7)', backdropFilter: 'blur(10px)', flexShrink: 0,
      }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-muted)', userSelect: 'none' }}>
          <input type="checkbox" checked={voiceEnabled} onChange={() => { if (voiceEnabled) { window.speechSynthesis?.cancel(); setIsSpeaking(false); } setVoiceEnabled(!voiceEnabled); }} style={{ accentColor: 'var(--accent-2)' }} />
          🔊 Voice
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-muted)', userSelect: 'none' }}>
          <input type="checkbox" checked={isCrew} onChange={() => setIsCrew(!isCrew)} style={{ accentColor: 'var(--accent-2)' }} />
          🤖 Multi-Agent
        </label>

        {/* Stop audio button — shown while speaking */}
        {isSpeaking && (
          <button onClick={stopAudio} style={{
            padding: '0.3rem 0.7rem', borderRadius: '999px', border: '1px solid rgba(239,68,68,0.4)',
            background: 'rgba(239,68,68,0.1)', color: '#ef4444', cursor: 'pointer',
            fontSize: '0.75rem', fontFamily: 'var(--font-body)', display: 'flex', alignItems: 'center', gap: '0.3rem',
            animation: 'pulsing 1.5s ease-in-out infinite',
          }}>
            ⏹ Stop audio
          </button>
        )}

        {/* Stop generation button — shown while loading */}
        {isLoading && (
          <button onClick={stopGeneration} style={{
            padding: '0.3rem 0.7rem', borderRadius: '999px', border: '1px solid rgba(245,158,11,0.4)',
            background: 'rgba(245,158,11,0.1)', color: '#f59e0b', cursor: 'pointer',
            fontSize: '0.75rem', fontFamily: 'var(--font-body)', display: 'flex', alignItems: 'center', gap: '0.3rem',
          }}>
            ⏹ Stop
          </button>
        )}
      </div>

      {/* Messages — position:relative anchors the floating selection popup */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', position: 'relative' }}>

        {/* ── Phase 4: floating "Ask about this" popup ── */}
        {selectionPopup && (
          <div
            id="ask-about-popup"
            style={{
              position: 'absolute',
              left:  selectionPopup.x,
              top:   selectionPopup.y,
              transform: 'translateX(-50%)',
              zIndex: 200,
              animation: 'fadeUp 0.15s var(--ease)',
            }}
          >
            <button
              onMouseDown={e => e.preventDefault()} // prevent blur from dismissing
              onClick={() => {
                setInput(`Regarding this: "${selectionPopup.text}"\n\n`);
                setSelectionPopup(null);
                window.getSelection()?.removeAllRanges();
                // Focus the text input
                const inp = document.querySelector<HTMLInputElement>('input[placeholder*="TESS"], input[placeholder*="message"], input[placeholder*="Message"]');
                inp?.focus();
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                padding: '0.35rem 0.85rem',
                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                border: 'none',
                borderRadius: '999px',
                color: '#fff',
                fontSize: '0.75rem',
                fontFamily: 'var(--font-body)',
                fontWeight: '600',
                cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(99,102,241,0.45), 0 0 0 1px rgba(255,255,255,0.08)',
                whiteSpace: 'nowrap',
                letterSpacing: '0.02em',
                transition: 'transform 0.1s, box-shadow 0.1s',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.06)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(99,102,241,0.6), 0 0 0 1px rgba(255,255,255,0.12)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(99,102,241,0.45), 0 0 0 1px rgba(255,255,255,0.08)'; }}
            >
              💬 Ask about this
            </button>
          </div>
        )}

        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '4rem', animation: 'fadeUp 0.5s var(--ease)' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '20px', background: 'linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(34,211,238,0.1) 100%)', border: '1px solid rgba(99,102,241,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.75rem', margin: '0 auto 1.25rem', boxShadow: '0 8px 32px rgba(99,102,241,0.15)' }}>🧠</div>
            <p style={{ fontFamily: 'var(--font-head)', fontSize: '1.05rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>TESS — Business AI Assistant</p>
            <p style={{ fontSize: '0.78rem', marginBottom: '1.5rem', opacity: 0.6 }}>Chat · Upload Files · Voice · Image Generation</p>
            <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '0.4rem', textAlign: 'left' }}>
              {[
                '💬  "Summarize my Q3 report"',
                '🎨  "/image a modern office dashboard"',
                '📋  "What tasks are pending today?"',
                '📎  Click + to attach any file — with or without a message',
              ].map((hint, i) => (
                <div key={i}
                  style={{ padding: '0.45rem 0.85rem', borderRadius: 'var(--r-md)', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', fontSize: '0.78rem', color: 'var(--text-muted)', cursor: 'pointer', transition: 'all var(--dur-fast)' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.25)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                  onClick={() => { if (!hint.includes('+')) setInput(hint.replace(/^[^"]*"/, '').replace(/"$/, '')); }}
                >{hint}</div>
              ))}
            </div>
          </div>
        )}

        {messages.map(m => (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : m.role === 'system' ? 'center' : 'flex-start', animation: 'fadeUp 0.2s var(--ease)' }}>
            {m.role === 'system' ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.35rem 0.85rem', borderRadius: '999px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', fontStyle: 'italic' }}>{m.content}</div>
            ) : (
              <div style={{ maxWidth: '72%' }}>
                {m.role === 'assistant' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                    <div style={{ width: '20px', height: '20px', borderRadius: '6px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem' }}>✦</div>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: '500', letterSpacing: '0.04em', textTransform: 'uppercase' }}>TESS</span>
                  </div>
                )}
                <div style={{
                  padding: m.files?.length ? '0.6rem 1.1rem 0.85rem' : '0.85rem 1.1rem',
                  background: m.role === 'user' ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' : 'rgba(255,255,255,0.04)',
                  border: m.role === 'user' ? 'none' : '1px solid var(--border)',
                  borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '4px 18px 18px 18px',
                  lineHeight: 1.65, wordBreak: 'break-word',
                  boxShadow: m.role === 'user' ? '0 4px 16px rgba(99,102,241,0.3)' : 'var(--shadow-sm)',
                  fontSize: '0.88rem', color: m.role === 'user' ? '#fff' : 'var(--text-primary)',
                }}>
                  {/* Persistent file chips inside the message bubble */}
                  {m.files && m.files.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: m.content ? '0.55rem' : 0 }}>
                      {m.files.map((f, fi) => (
                        <div key={fi} style={{
                          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                          padding: '0.25rem 0.6rem',
                          background: 'rgba(255,255,255,0.15)',
                          border: '1px solid rgba(255,255,255,0.25)',
                          borderRadius: '999px',
                          fontSize: '0.76rem', color: '#fff',
                        }}>
                          <span>{fileIcon(f.name)}</span>
                          <span style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                          <span style={{ opacity: 0.65, fontSize: '0.65rem', flexShrink: 0 }}>{formatBytes(f.size)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <MessageContent content={m.content} />
                  {m.imageUrl && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <img src={m.imageUrl} alt="" style={{ maxWidth: '100%', borderRadius: 'var(--r-md)', display: 'block', border: '1px solid var(--border)' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      <a href={m.imageUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.72rem', color: 'var(--accent-light)', display: 'inline-block', marginTop: '0.4rem' }}>↗ Open full size</a>
                    </div>
                  )}
                </div>
                {/* Action buttons below message */}
                <MessageActions
                  message={m}
                  onEdit={text => { setInput(text); }}
                  onRegenerate={m.role === 'assistant' ? () => {
                    // Find the preceding user message and resend it
                    const msgs = messages;
                    const idx = msgs.findIndex(x => x.id === m.id);
                    const prev = msgs.slice(0, idx).reverse().find(x => x.role === 'user');
                    if (prev) handleSend(prev.content);
                  } : undefined}
                />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', animation: 'fadeUp 0.2s var(--ease)' }}>
            <div style={{ width: '20px', height: '20px', borderRadius: '6px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem' }}>✦</div>
            <div style={{ padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '4px 18px 18px 18px', display: 'flex', gap: '5px', alignItems: 'center' }}>
              <span className="dot-pulse" /><span className="dot-pulse" style={{ animationDelay: '0.2s' }} /><span className="dot-pulse" style={{ animationDelay: '0.4s' }} />
            </div>
          </div>
        )}
      </div>

      {/* ── Input area ── */}
      <div style={{ padding: '0 1.25rem 1rem', background: 'rgba(10,12,20,0.95)', backdropFilter: 'blur(20px)', flexShrink: 0, borderTop: '1px solid var(--border)' }}>

        {/* Staged file chips — shown ABOVE the input bar */}
        {stagedFiles.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', padding: '0.65rem 0 0.4rem' }}>
            {stagedFiles.map(sf => (
              <div key={sf.id} style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                padding: '0.3rem 0.55rem 0.3rem 0.65rem',
                background: 'rgba(99,102,241,0.12)',
                border: '1px solid rgba(99,102,241,0.3)',
                borderRadius: '999px',
                fontSize: '0.78rem', color: 'var(--accent-light)',
                animation: 'fadeUp 0.15s var(--ease)',
              }}>
                <span>{fileIcon(sf.file.name)}</span>
                <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {sf.file.name}
                </span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                  {formatBytes(sf.file.size)}
                </span>
                <button
                  onClick={() => removeStagedFile(sf.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1, padding: '0 2px', marginLeft: '2px', flexShrink: 0 }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                >✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Input bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          background: 'rgba(255,255,255,0.03)',
          border: `1px solid ${canSend ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.08)'}`,
          borderRadius: '16px',
          padding: '0.5rem 0.5rem 0.5rem 0.65rem',
          boxShadow: '0 2px 0 rgba(255,255,255,0.03) inset, 0 8px 24px rgba(0,0,0,0.3)',
          marginTop: stagedFiles.length > 0 ? '0' : '0.65rem',
          transition: 'border-color var(--dur-fast)',
        }}>
          {/* Hidden file input — accepts everything */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.doc,.xlsx,.xls,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.gif,.mp3,.wav,.m4a,.mp4,.mov"
            style={{ display: 'none' }}
            onChange={e => { stageFiles(e.target.files); e.target.value = ''; }}
          />

          {/* + button */}
          <div ref={attachRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setShowAttach(v => !v)}
              title="Attach file"
              style={{
                width: '34px', height: '34px', borderRadius: '10px', border: 'none',
                background: showAttach ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)',
                color: showAttach ? 'var(--accent-light)' : 'var(--text-muted)',
                cursor: 'pointer', fontSize: '1.15rem', fontWeight: '300',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all var(--dur-fast)',
                transform: showAttach ? 'rotate(45deg)' : 'rotate(0deg)',
              }}
            >+</button>

            {showAttach && (
              <div style={{
                position: 'absolute', bottom: '44px', left: 0,
                background: 'rgba(13,15,24,0.98)', backdropFilter: 'blur(20px)',
                border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                overflow: 'hidden', minWidth: '210px', zIndex: 100,
                boxShadow: 'var(--shadow-xl)', animation: 'fadeUp 0.15s var(--ease)',
              }}>
                {[
                  { icon: '📄', label: 'Document',  sub: 'PDF · Word · Excel · TXT · CSV' },
                  { icon: '🖼️', label: 'Image',     sub: 'PNG · JPG · WEBP · GIF' },
                  { icon: '🎵', label: 'Audio',     sub: 'MP3 · WAV · M4A' },
                  { icon: '🎬', label: 'Video',     sub: 'MP4 · MOV' },
                ].map((item, i) => (
                  <React.Fragment key={item.label}>
                    {i > 0 && <div style={{ height: '1px', background: 'var(--border)' }} />}
                    <button
                      type="button"
                      onClick={() => { setShowAttach(false); fileInputRef.current?.click(); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.65rem',
                        width: '100%', padding: '0.65rem 1rem',
                        background: 'transparent', border: 'none',
                        color: 'var(--text-primary)', cursor: 'pointer',
                        fontSize: '0.85rem', textAlign: 'left',
                        transition: 'background var(--dur-fast)', fontFamily: 'var(--font-body)',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span style={{ fontSize: '1.1rem' }}>{item.icon}</span>
                      <div>
                        <div style={{ fontWeight: '500', fontSize: '0.83rem' }}>{item.label}</div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{item.sub}</div>
                      </div>
                    </button>
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>

          {/* Mic */}
          {speechOk && (
            <button
              type="button"
              onClick={() => isListening ? stopListening() : startListening()}
              style={{
                width: '34px', height: '34px', borderRadius: '10px', border: 'none', flexShrink: 0,
                background: isListening ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.05)',
                color: isListening ? '#ef4444' : 'var(--text-muted)',
                cursor: 'pointer', fontSize: '0.95rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all var(--dur-fast)',
                animation: isListening ? 'glowRing 1.5s ease-in-out infinite' : 'none',
              }}
            >{isListening ? '⏹' : '🎙️'}</button>
          )}

          {/* Text input */}
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            onPaste={e => {
              const items = Array.from(e.clipboardData?.items ?? []);
              const fileItems = items.filter(it => it.kind === 'file');
              if (fileItems.length === 0) return; // plain text paste — let browser handle normally
              e.preventDefault(); // block default paste for file items
              const toStage: File[] = fileItems.map((it, idx) => {
                const raw = it.getAsFile();
                if (!raw) return null;
                // Screenshot images have a generic name like "image.png" — make it unique
                const ext = raw.type.split('/')[1] || 'png';
                const name = raw.name && raw.name !== 'image.png' && raw.name !== 'blob'
                  ? raw.name
                  : `screenshot_${Date.now()}${idx > 0 ? `_${idx}` : ''}.${ext}`;
                return new File([raw], name, { type: raw.type });
              }).filter(Boolean) as File[];
              if (toStage.length > 0) stageFiles(toStage);
            }}
            placeholder={
              isListening ? '🎙️  Listening...' :
              stagedFiles.length > 0 ? 'Add a message or just hit send…' :
              'Message TESS or attach a file…'
            }
            disabled={isListening}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-primary)', fontSize: '0.9rem',
              fontFamily: 'var(--font-body)', padding: '0.4rem 0.3rem',
            }}
          />

          {/* Send — active when text OR file is ready */}
          <button
            type="button"
            onClick={() => handleSend()}
            disabled={!canSend}
            style={{
              width: '34px', height: '34px', borderRadius: '10px', border: 'none',
              background: canSend ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'rgba(99,102,241,0.1)',
              color: canSend ? 'white' : 'var(--text-muted)',
              cursor: canSend ? 'pointer' : 'not-allowed',
              fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all var(--dur-fast)', flexShrink: 0,
              boxShadow: canSend ? '0 2px 8px rgba(99,102,241,0.35)' : 'none',
            }}
          >↑</button>
        </div>
      </div>
    </div>
  );
}

// ── Message action buttons ────────────────────────────────────────────────────
function MessageActions({ message, onEdit, onRegenerate }: {
  message: { role: string; content: string };
  onEdit?: (text: string) => void;
  onRegenerate?: () => void;
}) {
  const [copied, setCopied] = React.useState(false);

  const copy = () => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const btn: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--text-muted)', fontSize: '0.7rem',
    padding: '0.2rem 0.5rem', borderRadius: '4px',
    display: 'flex', alignItems: 'center', gap: '0.25rem',
    fontFamily: 'var(--font-body)', transition: 'all 0.12s',
  };

  return (
    <div className="msg-actions" style={{ display: 'flex', gap: '0.1rem', marginTop: '0.3rem', opacity: 0, transition: 'opacity 0.15s' }}>
      <button style={btn} onClick={copy}
        onMouseEnter={e => { e.currentTarget.style.color='var(--text-secondary)'; e.currentTarget.style.background='rgba(255,255,255,0.05)'; }}
        onMouseLeave={e => { e.currentTarget.style.color='var(--text-muted)'; e.currentTarget.style.background='none'; }}>
        {copied ? '✓ Copied' : '⧉ Copy'}
      </button>
      {onEdit && message.role === 'user' && (
        <button style={btn} onClick={() => onEdit(message.content)}
          onMouseEnter={e => { e.currentTarget.style.color='var(--text-secondary)'; e.currentTarget.style.background='rgba(255,255,255,0.05)'; }}
          onMouseLeave={e => { e.currentTarget.style.color='var(--text-muted)'; e.currentTarget.style.background='none'; }}>
          ✏ Edit
        </button>
      )}
      {onRegenerate && message.role === 'assistant' && (
        <button style={btn} onClick={onRegenerate}
          onMouseEnter={e => { e.currentTarget.style.color='var(--accent-light)'; e.currentTarget.style.background='rgba(99,102,241,0.08)'; }}
          onMouseLeave={e => { e.currentTarget.style.color='var(--text-muted)'; e.currentTarget.style.background='none'; }}>
          ↺ Regenerate
        </button>
      )}
    </div>
  );
}

function MessageContent({ content }: { content: string }) {
  const parts = content.split(/(\*\*.*?\*\*)/g);
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <strong key={i} style={{ color: 'inherit', fontWeight: '600' }}>{p.slice(2,-2)}</strong>
          : <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{p}</span>
      )}
    </span>
  );
}
