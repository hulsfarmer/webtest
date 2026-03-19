import Link from 'next/link';
import { Sparkles } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="border-t border-white/5 py-8 sm:py-12 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 sm:gap-6">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-brand flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold gradient-text">ShortsAI</span>
            <span className="text-gray-600 text-xs sm:text-sm ml-2">사업장 홍보영상 자동 생성</span>
          </div>

          <nav className="flex gap-4 sm:gap-6 text-xs sm:text-sm text-gray-500">
            <Link href="/promo" className="hover:text-gray-300 transition-colors">
              홍보영상 만들기
            </Link>
            <a href="#pricing" className="hover:text-gray-300 transition-colors">
              가격
            </a>
            <a href="#how-it-works" className="hover:text-gray-300 transition-colors">
              사용방법
            </a>
          </nav>

          <p className="text-gray-600 text-xs sm:text-sm">
            © 2026 ShortsAI. Claude AI 기반
          </p>
        </div>
      </div>
    </footer>
  );
}
