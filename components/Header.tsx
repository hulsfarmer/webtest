'use client';

import Link from 'next/link';
import { Sparkles, LogOut, User, Settings, Film } from 'lucide-react';
import { useSession, signOut } from 'next-auth/react';

export default function Header() {
  const { data: session, status } = useSession();

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#0B0A14]/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-bold text-lg sm:text-xl shrink-0">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gradient-brand flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
          </div>
          <span className="gradient-text">ShortsAI</span>
        </Link>

        {/* Nav */}
        <nav className="hidden md:flex items-center gap-8 text-sm text-gray-400">
          <button onClick={() => scrollTo('how-it-works')} className="hover:text-white transition-colors">
            사용방법
          </button>
          <button onClick={() => scrollTo('pricing')} className="hover:text-white transition-colors">
            가격
          </button>
        </nav>

        {/* Auth */}
        <div className="flex items-center gap-1 sm:gap-2">
          {status === 'loading' ? (
            <div className="w-8 h-8 rounded-full bg-white/10 animate-pulse" />
          ) : session?.user ? (
            <>
              <div className="hidden sm:flex items-center gap-2 text-sm text-gray-300 mr-1">
                {session.user.image ? (
                  <img src={session.user.image} alt="" className="w-7 h-7 rounded-full" />
                ) : (
                  <User className="w-4 h-4" />
                )}
                <span className="max-w-[100px] lg:max-w-[120px] truncate">{session.user.name || session.user.email}</span>
              </div>
              <Link
                href="/history"
                className="p-2.5 sm:p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors active:bg-white/20"
                title="내 영상"
              >
                <Film className="w-5 h-5 sm:w-4 sm:h-4" />
              </Link>
              <Link
                href="/account"
                className="p-2.5 sm:p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors active:bg-white/20"
                title="내 계정"
              >
                <Settings className="w-5 h-5 sm:w-4 sm:h-4" />
              </Link>
              <button
                onClick={() => signOut({ callbackUrl: '/' })}
                className="p-2.5 sm:p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors active:bg-white/20"
                title="로그아웃"
              >
                <LogOut className="w-5 h-5 sm:w-4 sm:h-4" />
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="px-4 py-2.5 sm:py-2 rounded-lg bg-gradient-brand text-white text-sm font-semibold hover:opacity-90 transition-opacity active:opacity-80"
            >
              무료로 시작하기
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
