import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../src/authContext';
import { authLogin } from '../src/api';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const data = await authLogin(email, password);
      login(data.access_token);
      router.push('/');
    } catch (err: any) {
      setError(err.message ?? 'Login failed');
    } finally { setLoading(false); }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-base)', padding: '1rem', position: 'relative', overflow: 'hidden',
    }}>
      {/* Background orbs */}
      <div style={{ position: 'fixed', top: '10%', left: '15%', width: '400px', height: '400px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', bottom: '5%', right: '10%', width: '350px', height: '350px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(34,211,238,0.06) 0%, transparent 70%)', pointerEvents: 'none' }} />

      <div style={{
        width: '100%', maxWidth: '400px', position: 'relative', zIndex: 1,
        animation: 'fadeUp 0.4s var(--ease)',
      }}>
        {/* Card */}
        <div style={{
          background: 'rgba(13,15,24,0.9)',
          backdropFilter: 'blur(40px)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 'var(--r-2xl)',
          padding: '2.25rem',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.05) inset',
        }}>
          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div style={{
              width: '52px', height: '52px', borderRadius: '16px',
              background: 'var(--grad-accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.5rem', margin: '0 auto 1rem',
              boxShadow: 'var(--shadow-accent)',
            }}>🧠</div>
            <h1 style={{ fontFamily: 'var(--font-head)', fontWeight: '700', fontSize: '1.4rem', letterSpacing: '-0.02em', marginBottom: '0.3rem' }}>
              Welcome back
            </h1>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Sign in to your MemAI workspace</p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: '500', display: 'block', marginBottom: '0.35rem', letterSpacing: '0.02em' }}>
                EMAIL
              </label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="you@company.com" className="input-glass"
                style={{ width: '100%', padding: '0.75rem 1rem', fontSize: '0.9rem' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: '500', display: 'block', marginBottom: '0.35rem', letterSpacing: '0.02em' }}>
                PASSWORD
              </label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                placeholder="••••••••" className="input-glass"
                style={{ width: '100%', padding: '0.75rem 1rem', fontSize: '0.9rem' }} />
            </div>

            {error && (
              <div style={{
                padding: '0.65rem 0.9rem', borderRadius: 'var(--r-md)',
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                fontSize: '0.8rem', color: 'var(--danger)',
              }}>{error}</div>
            )}

            <button type="submit" disabled={loading} className="btn-primary"
              style={{ padding: '0.85rem', fontSize: '0.9rem', fontWeight: '600', borderRadius: 'var(--r-lg)', marginTop: '0.25rem' }}>
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  <span className="pulsing">⏳</span> Signing in...
                </span>
              ) : 'Sign In →'}
            </button>
          </form>

          <div style={{ height: '1px', background: 'linear-gradient(90deg, transparent, var(--border), transparent)', margin: '1.5rem 0' }} />

          <p style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            No account?{' '}
            <a href="/signup" style={{ color: 'var(--accent-light)', textDecoration: 'none', fontWeight: '500' }}>
              Create one free →
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
