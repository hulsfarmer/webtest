'use client';

import Link from 'next/link';
import { Sparkles } from 'lucide-react';

export default function Header() {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#0B0A14]/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-bold text-xl">
          <div className="w-8 h-8 rounded-lg bg-gradient-brand flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
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

        {/* CTA */}
        <Link
          href="/generate"
          className="px-4 py-2 rounded-lg bg-gradient-brand text-white text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          무료로 시작하기
        </Link>
      </div>
    </header>
  );
}
