'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import ThemeToggle from './ThemeToggle';

export default function LandingNav() {
  const { data: session, status } = useSession();
  const loggedIn = !!session?.user;

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
          {status === 'loading' ? null : loggedIn ? (
            <>
              <Link className="sa-btn text sa-hide-sm" href="/history">내 영상</Link>
              <Link className="sa-btn grad" href="/studio">스튜디오 →</Link>
            </>
          ) : (
            <>
              <Link className="sa-btn text sa-hide-sm" href="/login">로그인</Link>
              <Link className="sa-btn grad" href="/studio">스튜디오 시작</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
