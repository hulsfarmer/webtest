'use client';

import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import ThemeToggle from './ThemeToggle';

export default function LandingNav() {
  const { data: session, status } = useSession();
  const loggedIn = !!session?.user;
  const displayName = session?.user?.name || session?.user?.email?.split('@')[0] || '';

  return (
    <div className="sa-nav">
      <div className="sa-wrap sa-nav-row">
        <Link href="/" className="sa-brand"><span className="sa-mk">S</span>Shorts<b>AI</b></Link>

        <nav className="sa-links">
          <a href="#how">작동 방식</a>
          <a href="#tools">기능</a>
          <a href="#samples">샘플</a>
          <a href="#pricing">요금</a>
        </nav>

        <div className="sa-nav-right">
          <ThemeToggle />
          {/* 세션 확인 중에도 스튜디오 버튼은 항상 보이게 — 로그인/이름 부분만 확정 후 표시 */}
          {loggedIn && (
            <>
              <span className="sa-user sa-hide-sm">{displayName}님</span>
              <button className="sa-btn text sa-hide-sm" type="button" onClick={() => signOut({ callbackUrl: '/' })}>로그아웃</button>
            </>
          )}
          {status === 'unauthenticated' && (
            <Link className="sa-btn text sa-hide-sm" href="/login">로그인</Link>
          )}
          <Link className="sa-btn grad" href="/studio" prefetch>{loggedIn ? '스튜디오 →' : '스튜디오 시작'}</Link>
        </div>
      </div>
    </div>
  );
}
