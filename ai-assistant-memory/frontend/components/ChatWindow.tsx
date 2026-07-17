import React, { useState, useEffect, useRef } from 'react';
import { sendChatMessage } from '../src/api';

export default function ChatWindow({ userId }: { userId: string }) {
  const [messages, setMessages] = useState<{ role: string, content: string }[]>([]);
  const [input, setInput] = useState('');
  const [isCrew, setIsCrew] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await sendChatMessage(userMessage.content, userId, isCrew);
      setMessages(prev => [...prev, { role: 'assistant', content: response.reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: Could not connect to the assistant.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="chat-window" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="chat-header" style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', borderBottom: '1px solid var(--border)' }}>
        <h2>Chat</h2>
        <div className="mode-toggle">
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={isCrew} 
              onChange={() => setIsCrew(!isCrew)} 
            />
            Multi-Agent (CrewAI) Mode
          </label>
        </div>
      </div>

      <div className="chat-messages" ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            background: m.role === 'user' ? 'var(--accent)' : 'var(--bg-elevated)',
            padding: '1rem',
            borderRadius: '8px',
            maxWidth: '80%'
          }}>
            {m.content}
          </div>
        ))}
        {isLoading && (
          <div style={{ alignSelf: 'flex-start', background: 'var(--bg-elevated)', padding: '1rem', borderRadius: '8px' }}>
            <span className="pulsing">Thinking...</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSend} style={{ display: 'flex', padding: '1rem', borderTop: '1px solid var(--border)', gap: '1rem' }}>
        <input 
          type="text" 
          value={input} 
          onChange={(e) => setInput(e.target.value)} 
          placeholder="Type your message..."
          style={{ flex: 1, padding: '0.8rem', borderRadius: '4px', background: 'var(--bg-elevated)', color: 'white', border: '1px solid var(--border)' }}
        />
        <button type="submit" style={{ padding: '0.8rem 1.5rem', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          Send
        </button>
      </form>
    </div>
  );
}
