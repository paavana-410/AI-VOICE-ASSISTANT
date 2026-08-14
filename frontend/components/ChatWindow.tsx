import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../src/authContext';
import { sendChatMessage, generateImage, ingestFile } from '../src/api';

type MessageRole = 'user' | 'assistant' | 'system';
interface Message { id: number; role: MessageRole; content: string; imageUrl?: string; }

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
  if (!voices.length) return null;
  const names = ['zira','samantha','aria','jenny','michelle','sonia','ana','monica'];
  return voices.find(v => v.lang.startsWith('en-US') && names.some(n => v.name.toLowerCase().includes(n)))
    ?? voices.find(v => v.lang.startsWith('en-US'))
    ?? voices[0];
}

function speak(text: string, voice: SpeechSynthesisVoice | null) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const clean = text.replace(/\*\*(.*?)\*\*/g,'$1').replace(/\*(.*?)\*/g,'$1').replace(/`[^`]+`/g,'').replace(/#{1,6}\s/g,'').substring(0, 500);
  const u = new SpeechSynthesisUtterance(clean);
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? 'en-US';
  u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;
  window.speechSynthesis.speak(u);
}

let msgId = 0;

export default function ChatWindow({ onRegisterLoader }: Props) {
  const { accessToken } = useAuth();
  const [messages, setMessages]       = useState<Message[]>([]);
  const [input, setInput]             = useState('');
  const [isCrew, setIsCrew]           = useState(false);
  const [isLoading, setIsLoading]     = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [speechOk, setSpeechOk]       = useState(false);
  const [selectedVoice, setVoice]     = useState<SpeechSynthesisVoice | null>(null);
  const [showAttach, setShowAttach]   = useState(false);
  const [sessionId, setSessionId]     = useState<string | null>(null);

  const scrollRef      = useRef<HTMLDivElement>(null);
  const recogRef       = useRef<any>(null);
  const attachRef      = useRef<HTMLDivElement>(null);
  const docInputRef    = useRef<HTMLInputElement>(null);
  const imgInputRef    = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSpeechOk(!!(window.SpeechRecognition || window.webkitSpeechRecognition));
    const load = () => { const v = window.speechSynthesis.getVoices(); if (v.length) setVoice(pickUSFemaleVoice(v) ?? null); };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  // Register session loader so parent can push historical messages
  useEffect(() => {
    if (!onRegisterLoader) return;
    onRegisterLoader((msgs) => {
      msgId = 0;
      setSessionId(null); // treat loaded session as read-only view
      setMessages(msgs.map(m => {
        msgId++;
        return { id: msgId, role: m.role as MessageRole, content: m.content };
      }));
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

  const addMsg = useCallback((role: MessageRole, content: string, imageUrl?: string) => {
    msgId++; setMessages(p => [...p, { id: msgId, role, content, imageUrl }]); return msgId;
  }, []);

  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || !accessToken) return;
    addMsg('user', text); setInput(''); setIsLoading(true);
    const imgPrompt = detectImageRequest(text);
    try {
      if (imgPrompt) {
        addMsg('system', `🎨 Generating "${imgPrompt}"...`);
        const r = await generateImage(accessToken, imgPrompt);
        msgId++;
        setMessages(p => [...p.filter(m => m.role !== 'system'), { id: msgId, role: 'assistant', content: `Here's your image: **${imgPrompt}**`, imageUrl: r.url }]);
        if (voiceEnabled) speak(`Here's your generated image of ${imgPrompt}`, selectedVoice);
      } else {
        const r = await sendChatMessage(accessToken, text, isCrew, sessionId);
        addMsg('assistant', r.reply);
        if (r.session_id) setSessionId(r.session_id);
        if (voiceEnabled) speak(r.reply, selectedVoice);
      }
    } catch (err: any) {
      addMsg('assistant', `⚠️ ${err.message ?? 'Could not connect to assistant.'}`);
    } finally { setIsLoading(false); }
  }, [accessToken, isCrew, voiceEnabled, selectedVoice, addMsg]);

  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files || !files.length || !accessToken) return;
    setShowAttach(false);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      msgId++;
      const uid = msgId;
      setMessages(p => [...p, { id: uid, role: 'system', content: `📎 Uploading "${file.name}"...` }]);
      try {
        const r = await ingestFile(accessToken, file);
        setMessages(p => p.map(m => m.id === uid ? { ...m, content: `✅ "${r.filename}" — ${r.chunks_stored} chunks stored in memory` } : m));
        if (voiceEnabled) speak(`${r.filename} has been saved to memory.`, selectedVoice);
      } catch (err: any) {
        setMessages(p => p.map(m => m.id === uid ? { ...m, content: `❌ Failed: ${err.message}` } : m));
      }
    }
  }, [accessToken, voiceEnabled, selectedVoice]);

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)' }}>

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        padding: '0.6rem 1.25rem', gap: '0.75rem',
        borderBottom: '1px solid var(--border)',
        background: 'rgba(13,15,24,0.7)',
        backdropFilter: 'blur(10px)',
        flexShrink: 0,
      }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-muted)', userSelect: 'none' }}>
          <input type="checkbox" checked={voiceEnabled} onChange={() => { if (voiceEnabled) window.speechSynthesis?.cancel(); setVoiceEnabled(!voiceEnabled); }} style={{ accentColor: 'var(--accent-2)' }} />
          🔊 Voice
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-muted)', userSelect: 'none' }}>
          <input type="checkbox" checked={isCrew} onChange={() => setIsCrew(!isCrew)} style={{ accentColor: 'var(--accent-2)' }} />
          🤖 Multi-Agent
        </label>
        {isCrew && <span className="badge badge-purple" style={{ fontSize: '0.65rem' }}>CrewAI</span>}
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '4rem', animation: 'fadeUp 0.5s var(--ease)' }}>
            <div style={{
              width: '64px', height: '64px', borderRadius: '20px',
              background: 'linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(34,211,238,0.1) 100%)',
              border: '1px solid rgba(99,102,241,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.75rem', margin: '0 auto 1.25rem',
              boxShadow: '0 8px 32px rgba(99,102,241,0.15)',
            }}>🧠</div>
            <p style={{ fontFamily: 'var(--font-head)', fontSize: '1.05rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
              ARIA — Business AI Assistant
            </p>
            <p style={{ fontSize: '0.78rem', marginBottom: '1.5rem', opacity: 0.6 }}>Chat · Documents · Voice · Image Generation</p>
            <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '0.4rem', textAlign: 'left' }}>
              {[
                '💬  "Summarize my Q3 report"',
                '🎨  "/image a modern office dashboard"',
                '📋  "What tasks are pending today?"',
                '📂  Click + to upload a document',
              ].map((hint, i) => (
                <div key={i} style={{
                  padding: '0.45rem 0.85rem', borderRadius: 'var(--r-md)',
                  background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                  fontSize: '0.78rem', color: 'var(--text-muted)',
                  cursor: 'pointer', transition: 'all var(--dur-fast)',
                }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.25)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                  onClick={() => { if (!hint.includes('+')) { const t = hint.replace(/^[^"]*"/, '').replace(/"$/, ''); setInput(t); } }}
                >{hint}</div>
              ))}
            </div>
          </div>
        )}

        {messages.map(m => (
          <div key={m.id} style={{
            display: 'flex',
            justifyContent: m.role === 'user' ? 'flex-end' : m.role === 'system' ? 'center' : 'flex-start',
            animation: 'fadeUp 0.2s var(--ease)',
          }}>
            {m.role === 'system' ? (
              <div style={{
                fontSize: '0.75rem', color: 'var(--text-muted)',
                padding: '0.35rem 0.85rem', borderRadius: '999px',
                background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                fontStyle: 'italic',
              }}>{m.content}</div>
            ) : (
              <div style={{ maxWidth: '72%' }}>
                {m.role === 'assistant' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                    <div style={{
                      width: '20px', height: '20px', borderRadius: '6px',
                      background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem',
                    }}>✦</div>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: '500', letterSpacing: '0.04em', textTransform: 'uppercase' }}>ARIA</span>
                  </div>
                )}
                <div style={{
                  padding: '0.85rem 1.1rem',
                  background: m.role === 'user'
                    ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
                    : 'rgba(255,255,255,0.04)',
                  border: m.role === 'user' ? 'none' : '1px solid var(--border)',
                  borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '4px 18px 18px 18px',
                  lineHeight: 1.65, wordBreak: 'break-word',
                  boxShadow: m.role === 'user' ? '0 4px 16px rgba(99,102,241,0.3)' : 'var(--shadow-sm)',
                  fontSize: '0.88rem',
                  color: m.role === 'user' ? '#fff' : 'var(--text-primary)',
                }}>
                  <MessageContent content={m.content} />
                  {m.imageUrl && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <img src={m.imageUrl} alt="" style={{ maxWidth: '100%', borderRadius: 'var(--r-md)', display: 'block', border: '1px solid var(--border)' }}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      <a href={m.imageUrl} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: '0.72rem', color: 'var(--accent-light)', display: 'inline-block', marginTop: '0.4rem' }}>
                        ↗ Open full size
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', animation: 'fadeUp 0.2s var(--ease)' }}>
            <div style={{ width: '20px', height: '20px', borderRadius: '6px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem' }}>✦</div>
            <div style={{ padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '4px 18px 18px 18px', display: 'flex', gap: '5px', alignItems: 'center' }}>
              <span className="dot-pulse" />
              <span className="dot-pulse" style={{ animationDelay: '0.2s' }} />
              <span className="dot-pulse" style={{ animationDelay: '0.4s' }} />
            </div>
          </div>
        )}
      </div>

      {/* ── Premium Input Bar ── */}
      <div style={{
        padding: '0.85rem 1.25rem 1rem',
        borderTop: '1px solid var(--border)',
        background: 'rgba(10,12,20,0.95)',
        backdropFilter: 'blur(20px)',
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px',
          padding: '0.5rem 0.5rem 0.5rem 0.65rem',
          boxShadow: '0 2px 0 rgba(255,255,255,0.03) inset, 0 -1px 0 rgba(0,0,0,0.3) inset, 0 8px 24px rgba(0,0,0,0.3)',
          transition: 'border-color var(--dur-fast), box-shadow var(--dur-fast)',
        }}
          onFocusCapture={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(99,102,241,0.35)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 0 3px rgba(99,102,241,0.08), 0 8px 24px rgba(0,0,0,0.3)'; }}
          onBlurCapture={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.08)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 0 rgba(255,255,255,0.03) inset, 0 8px 24px rgba(0,0,0,0.3)'; }}
        >
          {/* Hidden file inputs */}
          <input ref={docInputRef} type="file" multiple accept=".pdf,.docx,.doc,.xlsx,.xls,.txt" style={{ display:'none' }} onChange={e => handleFileUpload(e.target.files)} />
          <input ref={imgInputRef} type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif" style={{ display:'none' }} onChange={e => handleFileUpload(e.target.files)} />

          {/* + Attach */}
          <div ref={attachRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button type="button" onClick={() => setShowAttach(v => !v)}
              style={{
                width: '34px', height: '34px', borderRadius: '10px', border: 'none',
                background: showAttach ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)',
                color: showAttach ? 'var(--accent-light)' : 'var(--text-muted)',
                cursor: 'pointer', fontSize: '1.1rem', fontWeight: '300',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all var(--dur-fast)',
                transform: showAttach ? 'rotate(45deg)' : 'rotate(0deg)',
              }}>+</button>
            {showAttach && (
              <div style={{
                position: 'absolute', bottom: '44px', left: 0,
                background: 'rgba(13,15,24,0.98)', backdropFilter: 'blur(20px)',
                border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                overflow: 'hidden', minWidth: '200px', zIndex: 100,
                boxShadow: 'var(--shadow-xl)',
                animation: 'fadeUp 0.15s var(--ease)',
              }}>
                {[
                  { icon: '📄', label: 'Upload Document', sub: 'PDF · Word · Excel · TXT', onClick: () => docInputRef.current?.click() },
                  { icon: '🖼️', label: 'Upload Image', sub: 'PNG · JPG · WEBP', onClick: () => imgInputRef.current?.click() },
                ].map((item, i) => (
                  <React.Fragment key={item.label}>
                    {i > 0 && <div style={{ height: '1px', background: 'var(--border)' }} />}
                    <button type="button" onClick={item.onClick}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.65rem',
                        width: '100%', padding: '0.7rem 1rem',
                        background: 'transparent', border: 'none',
                        color: 'var(--text-primary)', cursor: 'pointer',
                        fontSize: '0.85rem', textAlign: 'left', transition: 'background var(--dur-fast)',
                        fontFamily: 'var(--font-body)',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span style={{ fontSize: '1.1rem' }}>{item.icon}</span>
                      <div>
                        <div style={{ fontWeight: '500', fontSize: '0.83rem' }}>{item.label}</div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{item.sub}</div>
                      </div>
                    </button>
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>

          {/* Mic */}
          {speechOk && (
            <button type="button" onClick={() => isListening ? stopListening() : startListening()}
              style={{
                width: '34px', height: '34px', borderRadius: '10px', border: 'none', flexShrink: 0,
                background: isListening ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.05)',
                color: isListening ? '#ef4444' : 'var(--text-muted)',
                cursor: 'pointer', fontSize: '0.95rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all var(--dur-fast)',
                animation: isListening ? 'glowRing 1.5s ease-in-out infinite' : 'none',
              }}>
              {isListening ? '⏹' : '🎙️'}
            </button>
          )}

          {/* Text input */}
          <input type="text" value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(input); } }}
            placeholder={isListening ? '🎙️  Listening...' : 'Message ARIA...'}
            disabled={isListening}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-primary)', fontSize: '0.9rem',
              fontFamily: 'var(--font-body)', padding: '0.4rem 0.3rem',
            }} />

          {/* Send */}
          <button type="button" onClick={() => handleSend(input)}
            disabled={isLoading || !input.trim()}
            style={{
              width: '34px', height: '34px', borderRadius: '10px', border: 'none',
              background: isLoading || !input.trim() ? 'rgba(99,102,241,0.1)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: isLoading || !input.trim() ? 'var(--text-muted)' : 'white',
              cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer',
              fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all var(--dur-fast)', flexShrink: 0,
              boxShadow: input.trim() ? '0 2px 8px rgba(99,102,241,0.35)' : 'none',
            }}>↑</button>
        </div>
      </div>
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
