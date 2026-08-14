import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../src/authContext';
import { authRegister } from '../src/api';

export default function SignupPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setLoading(true);
    try {
      const data = await authRegister(email, password);
      login(data.access_token);
      router.push('/');
    } catch (err: any) {
      setError(err.message ?? 'Registration failed');
    } finally { setLoading(false); }
  };

  const strength = password.length === 0 ? 0 : password.length < 6 ? 1 : password.length < 10 ? 2 : 3;
  const strengthColor = ['transparent','var(--danger)','var(--warning)','var(--success)'][strength];

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-base)', padding: '1rem', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'fixed', top: '10%', right: '15%', width: '400px', height: '400px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', bottom: '5%', left: '10%', width: '350px', height: '350px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(34,211,238,0.06) 0%, transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ width: '100%', maxWidth: '400px', position: 'relative', zIndex: 1, animation: 'fadeUp 0.4s var(--ease)' }}>
        <div style={{
          background: 'rgba(13,15,24,0.9)', backdropFilter: 'blur(40px)',
          border: '1px solid rgba(255,255,255,0.07)', borderRadius: 'var(--r-2xl)',
          padding: '2.25rem',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.05) inset',
        }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div style={{
              width: '52px', height: '52px', borderRadius: '16px',
              background: 'var(--grad-accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.5rem', margin: '0 auto 1rem',
              boxShadow: 'var(--shadow-accent)',
            }}>🧠</div>
            <h1 style={{ fontFamily: 'var(--font-head)', fontWeight: '700', fontSize: '1.4rem', letterSpacing: '-0.02em', marginBottom: '0.3rem' }}>
              Create your workspace
            </h1>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Your AI assistant is waiting</p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: '500', display: 'block', marginBottom: '0.35rem', letterSpacing: '0.02em' }}>EMAIL</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="you@company.com" className="input-glass"
                style={{ width: '100%', padding: '0.75rem 1rem', fontSize: '0.9rem' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: '500', display: 'block', marginBottom: '0.35rem', letterSpacing: '0.02em' }}>PASSWORD</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                placeholder="Min. 8 characters" className="input-glass"
                style={{ width: '100%', padding: '0.75rem 1rem', fontSize: '0.9rem' }} />
              {/* Strength bar */}
              {password.length > 0 && (
                <div style={{ display: 'flex', gap: '3px', marginTop: '6px' }}>
                  {[1,2,3].map(i => (
                    <div key={i} style={{ flex: 1, height: '3px', borderRadius: '2px', background: i <= strength ? strengthColor : 'rgba(255,255,255,0.06)', transition: 'background 0.2s' }} />
                  ))}
                </div>
              )}
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: '500', display: 'block', marginBottom: '0.35rem', letterSpacing: '0.02em' }}>CONFIRM PASSWORD</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required
                placeholder="••••••••" className="input-glass"
                style={{ width: '100%', padding: '0.75rem 1rem', fontSize: '0.9rem', borderColor: confirm && confirm !== password ? 'rgba(239,68,68,0.4)' : undefined }} />
            </div>

            {error && (
              <div style={{ padding: '0.65rem 0.9rem', borderRadius: 'var(--r-md)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', fontSize: '0.8rem', color: 'var(--danger)' }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary"
              style={{ padding: '0.85rem', fontSize: '0.9rem', fontWeight: '600', borderRadius: 'var(--r-lg)', marginTop: '0.25rem' }}>
              {loading ? <span className="pulsing">⏳ Creating account...</span> : 'Get Started →'}
            </button>
          </form>

          <div style={{ height: '1px', background: 'linear-gradient(90deg, transparent, var(--border), transparent)', margin: '1.5rem 0' }} />
          <p style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Already have an account?{' '}
            <a href="/login" style={{ color: 'var(--accent-light)', textDecoration: 'none', fontWeight: '500' }}>
              Sign in →
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
