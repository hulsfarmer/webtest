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

          <nav className="flex flex-wrap justify-center gap-x-4 gap-y-2 sm:gap-6 text-xs sm:text-sm text-gray-500">
            <Link href="/promo" className="hover:text-gray-300 transition-colors">
              홍보영상 만들기
            </Link>
            <a href="#pricing" className="hover:text-gray-300 transition-colors">
              가격
            </a>
            <a href="#how-it-works" className="hover:text-gray-300 transition-colors">
              사용방법
            </a>
            <Link href="/terms" className="hover:text-gray-300 transition-colors">
              이용약관
            </Link>
            <Link href="/privacy" className="hover:text-gray-300 transition-colors">
              개인정보처리방침
            </Link>
            <Link href="/refund" className="hover:text-gray-300 transition-colors">
              환불정책
            </Link>
          </nav>

          <p className="text-gray-600 text-xs sm:text-sm">
            © 2026 ShortsAI. Claude AI 기반
          </p>
        </div>

        {/* 사업자 정보 (전자상거래법 표기 의무) */}
        <div className="mt-8 pt-6 border-t border-white/5 text-gray-600 text-[11px] sm:text-xs leading-relaxed space-y-1">
          <p>
            <span className="text-gray-500">상호</span> 이지온
            <span className="mx-1.5 text-gray-700">|</span>
            <span className="text-gray-500">대표</span> 안수동
            <span className="mx-1.5 text-gray-700">|</span>
            <span className="text-gray-500">사업자등록번호</span> 794-03-04121
          </p>
          <p>
            <span className="text-gray-500">통신판매업신고</span> 제2026-제주제주시-____호
          </p>
          <p>
            <span className="text-gray-500">주소</span> 제주특별자치도 제주시 조천읍 함덕12길 46-1, 202호
          </p>
          <p>
            <span className="text-gray-500">고객문의</span> 010-4149-0673
            <span className="mx-1.5 text-gray-700">|</span>
            <a href="mailto:support@shortsai.kr" className="hover:text-gray-400">support@shortsai.kr</a>
          </p>
          <p className="text-gray-700">호스팅 제공: Amazon Web Services</p>
        </div>
      </div>
    </footer>
  );
}
