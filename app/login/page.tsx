'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import './login.css';

const GoogleSvg = (
  <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
);
const KakaoSvg = (
  <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#191919" d="M12 3C6.48 3 2 6.36 2 10.5c0 2.67 1.77 5.02 4.44 6.34-.2.73-.72 2.65-.82 3.06-.13.5.18.49.38.36.16-.1 2.5-1.7 3.51-2.39.49.07.99.13 1.49.13 5.52 0 10-3.36 10-7.5S17.52 3 12 3z" /></svg>
);

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [social, setSocial] = useState<'' | 'Google' | '카카오'>('');

  // 로그인 후 이동할 곳: ?callbackUrl 우선(내부 경로만 허용) — 툴·스튜디오 가려다
  // 로그인한 경우 그 페이지로. 없으면 왔던 자리(랜딩)에 그대로 둔다.
  function getCallback() {
    if (typeof window === 'undefined') return '/';
    const cb = new URLSearchParams(window.location.search).get('callbackUrl');
    return cb && cb.startsWith('/') && !cb.startsWith('//') ? cb : '/';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'signup') {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || '가입에 실패했습니다.');
          setLoading(false);
          return;
        }
      }
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        setError('이메일 또는 비밀번호가 올바르지 않습니다.');
        setLoading(false);
        return;
      }
      window.location.href = getCallback();
    } catch {
      setError('처리 중 오류가 발생했습니다.');
      setLoading(false);
    }
  }

  return (
    <main className="lg-root">
      <div className="lg-aurora" />
      <div className="lg-wrap">
        <Link href="/" className="lg-brand"><span className="mk">S</span>Shorts<b>AI</b></Link>

        <div className="lg-card">
          {social && (
            <div className="lg-loading"><div className="spin" /><p>{social} 계정으로 로그인 중입니다…</p></div>
          )}
          <h1 className="lg-title">{mode === 'login' ? '로그인' : '회원가입'}</h1>
          <p className="lg-desc">{mode === 'login' ? '이메일 또는 소셜 계정으로 시작하세요' : '이메일로 새 계정을 만드세요'}</p>

          {error && <div className="lg-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            {mode === 'signup' && (
              <div className="lg-field"><input className="lg-inp" type="text" placeholder="이름 (선택)" value={name} onChange={(e) => setName(e.target.value)} /></div>
            )}
            <div className="lg-field"><input className="lg-inp" type="email" required placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="lg-field"><input className="lg-inp" type="password" required placeholder={mode === 'signup' ? '비밀번호 (8자 이상)' : '비밀번호'} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            <button className="lg-submit" type="submit" disabled={loading}>
              {loading ? '처리 중...' : mode === 'login' ? '이메일로 로그인' : '가입하고 시작하기'}
            </button>
          </form>

          <div className="lg-toggle">
            {mode === 'login' ? (
              <>계정이 없으신가요? <button type="button" onClick={() => { setMode('signup'); setError(''); }}>회원가입</button></>
            ) : (
              <>이미 계정이 있으신가요? <button type="button" onClick={() => { setMode('login'); setError(''); }}>로그인</button></>
            )}
          </div>

          <div className="lg-divider">또는 소셜 계정</div>

          <div className="lg-social">
            <button className="lg-google" type="button" disabled={!!social} onClick={() => { setSocial('Google'); signIn('google', { callbackUrl: getCallback() }); }}>{GoogleSvg} Google로 계속하기</button>
            <button className="lg-kakao" type="button" disabled={!!social} onClick={() => { setSocial('카카오'); signIn('kakao', { callbackUrl: getCallback() }); }}>{KakaoSvg} 카카오로 계속하기</button>
          </div>

          <p className="lg-terms">로그인하면 서비스 이용약관에 동의하게 됩니다</p>
        </div>

        <Link href="/" className="lg-back">← 홈으로 돌아가기</Link>
      </div>
    </main>
  );
}
