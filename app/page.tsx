'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { ArrowRight, Play, Sparkles, MonitorPlay, Store, CalendarDays } from 'lucide-react';
import Header from '@/components/Header';
import HowItWorks from '@/components/HowItWorks';
import PricingSection from '@/components/PricingSection';
import TestimonialsSection from '@/components/TestimonialsSection';
import Footer from '@/components/Footer';

const DEFAULT_SAMPLES = [
  { src: '/sample/demo.mp4', poster: '/sample/demo_thumb.jpg' },
  { src: '/sample/demo2.mp4', poster: '/sample/demo2_thumb.jpg' },
  { src: '/sample/demo3.mp4', poster: '/sample/demo3_thumb.jpg' },
];

const businessTypes = ['카페', '식당', '헬스장', '미용실', '네일샵', '꽃집', '베이커리', '학원'];

interface ShowcaseVideo {
  videoUrl: string;
  posterUrl: string | null;
  businessName: string | null;
  businessType: string | null;
  rating: number;
}

export default function HomePage() {
  const [showcaseVideos, setShowcaseVideos] = useState<ShowcaseVideo[]>([]);

  useEffect(() => {
    fetch('/api/showcase')
      .then(r => r.json())
      .then(data => {
        if (data.videos && data.videos.length > 0) {
          setShowcaseVideos(data.videos);
        }
      })
      .catch(() => {});
  }, []);

  // 실제 승인된 쇼케이스 영상만 표시(최대 6). 없을 때만 기본 샘플로 대체.
  const sampleSources: { src: string; poster: string | null; showcase?: ShowcaseVideo }[] = showcaseVideos.length > 0
    ? showcaseVideos.slice(0, 6).map(v => ({ src: v.videoUrl, poster: v.posterUrl, showcase: v }))
    : DEFAULT_SAMPLES.map(s => ({ src: s.src, poster: s.poster }));

  return (
    <main className="min-h-screen bg-[#0F172A] text-white overflow-x-hidden">
      <Header />

      {/* Hero */}
      <section className="relative pt-24 sm:pt-32 pb-16 sm:pb-20 px-4 sm:px-6 overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] sm:w-[800px] h-[400px] sm:h-[600px] bg-emerald-600/10 rounded-full blur-[120px]" />
          <div className="absolute top-20 left-1/3 w-[300px] sm:w-[400px] h-[300px] sm:h-[400px] bg-purple-600/8 rounded-full blur-[100px]" />
        </div>

        <div className="relative max-w-5xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs sm:text-sm font-medium mb-6 sm:mb-8">
            <Sparkles className="w-3.5 h-3.5" />
            막강 클로드 기반 사업장 홍보영상 자동 생성
          </div>

          {/* Headline — fixed height to prevent CLS */}
          <h1 className="text-3xl sm:text-4xl md:text-6xl lg:text-7xl font-extrabold leading-tight mb-4 sm:mb-6">
            <span className="gradient-text">고화질 3분 완성!</span>
          </h1>

          <p className="text-base sm:text-lg text-gray-300 mb-4 sm:mb-6 font-medium">
            업종 상관없이 누구나 전문가급 홍보영상 · 한국어 완벽 지원
          </p>

          <p className="text-base sm:text-xl text-gray-400 max-w-2xl mx-auto mb-8 sm:mb-10 leading-relaxed">
            업체명과 사진만 입력하면 <strong className="text-white">스크립트 → 음성 → BGM → 영상</strong>까지
            <br className="hidden md:block" />
            모두 자동으로 완성. 전문 영상 제작사 없이도 SNS 홍보 쇼츠 완성.
          </p>

          {/* Two entry cards: 업체 / 행사 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 max-w-2xl mx-auto mb-5">
            <Link
              href="/promo"
              className="group relative rounded-2xl p-5 sm:p-6 bg-gradient-brand text-white text-left hover:opacity-95 transition-all glow-purple active:opacity-85"
            >
              <Store className="w-7 h-7 mb-3" />
              <div className="text-lg font-bold mb-1">업체 홍보영상</div>
              <p className="text-white/80 text-sm mb-3">가게·회사·농장·병원 등 사업장 소개</p>
              <span className="inline-flex items-center gap-1 text-sm font-semibold">
                무료로 시작 <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </Link>
            <Link
              href="/promo?mode=event"
              className="group relative rounded-2xl p-5 sm:p-6 bg-white/5 border border-white/10 text-white text-left hover:bg-white/10 hover:border-emerald-500/40 transition-all active:bg-white/15"
            >
              <CalendarDays className="w-7 h-7 mb-3 text-emerald-400" />
              <div className="text-lg font-bold mb-1">행사 홍보영상</div>
              <p className="text-gray-400 text-sm mb-3">축제·공연·세일·오픈 등 이벤트 안내</p>
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-300">
                무료로 시작 <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </Link>
          </div>
          <div className="flex justify-center mb-8 sm:mb-10">
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-white/5 text-white font-semibold text-sm sm:text-base hover:bg-white/10 transition-all border border-white/10 active:bg-white/15"
            >
              <Play className="w-4 h-4" />
              작동 방식 보기
            </a>
          </div>

          {/* Business type pills */}
          <div className="mb-8 sm:mb-12">
            <p className="text-gray-500 text-xs sm:text-sm mb-3">이런 업종에 딱 맞습니다</p>
            <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
              {businessTypes.map((type) => (
                <span
                  key={type}
                  className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full bg-white/5 border border-white/10 text-gray-300 text-xs sm:text-sm hover:border-emerald-500/40 transition-colors cursor-default"
                >
                  {type}
                </span>
              ))}
            </div>
          </div>

        </div>
      </section>

      {/* Sample Videos */}
      <section className="py-12 sm:py-16 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3">
            실제 생성된 <span className="gradient-text">홍보영상</span>
          </h2>
          <p className="text-gray-400 text-sm sm:text-base mb-6 sm:mb-8">
            {showcaseVideos.length > 0 ? '실제 사용자가 만든 홍보영상입니다' : 'AI가 자동으로 만든 실제 홍보영상입니다'}
          </p>
          {/* 반응형 그리드: 모바일 2열, 데스크톱 3열 (최대 6개 = 2행) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-5">
            {sampleSources.map((item) => (
              <div key={item.src} className="glass-card p-2 sm:p-3 rounded-2xl">
                <video
                  src={item.src}
                  poster={item.poster || undefined}
                  controls
                  playsInline
                  preload="metadata"
                  className="w-full rounded-xl aspect-[9/16] bg-gray-900"
                />
                {item.showcase && (
                  <p className="text-gray-400 text-xs mt-2 text-center">
                    {item.showcase.businessName}
                    {item.showcase.businessType && ` · ${item.showcase.businessType}`}
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="text-gray-500 text-xs sm:text-sm mt-4">
            업체명과 사진만 입력 → 3분 만에 이런 영상이 완성됩니다
          </p>
        </div>
      </section>

      <HowItWorks />

      {/* How to Use Video */}
      <section className="py-12 sm:py-16 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs sm:text-sm font-medium mb-6">
            <MonitorPlay className="w-3.5 h-3.5" />
            실제 사용 영상
          </div>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3">
            이렇게 쉽게 <span className="gradient-text">만들어집니다</span>
          </h2>
          <p className="text-gray-400 text-sm sm:text-base mb-6 sm:mb-8">ShortsAI로 홍보영상 만드는 전체 과정을 확인하세요</p>
          <div className="glass-card p-2 sm:p-4 rounded-2xl max-w-2xl mx-auto">
            <video
              src="/sample/how-to-use.mp4"
              poster="/sample/how-to-use_thumb.jpg"
              controls
              playsInline
              preload="metadata"
              className="w-full rounded-xl bg-gray-900"
            />
          </div>
          <p className="text-gray-500 text-xs sm:text-sm mt-4">
            업체명 입력부터 완성 영상 다운로드까지, 단 3분이면 충분합니다
          </p>
        </div>
      </section>

      <PricingSection />

      <TestimonialsSection />

      {/* Final CTA */}
      <section className="py-16 sm:py-24 px-4 sm:px-6">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl md:text-5xl font-bold mb-4 sm:mb-6">
            지금 바로 <span className="gradient-text">시작해보세요</span>
          </h2>
          <p className="text-gray-400 text-base sm:text-lg mb-6 sm:mb-8">
            신용카드 없이 무료로 3개 홍보영상을 만들어보세요
          </p>
          <Link
            href="/promo"
            className="inline-flex items-center gap-2 px-8 sm:px-10 py-4 sm:py-5 rounded-xl bg-gradient-brand text-white font-bold text-base sm:text-lg hover:opacity-90 transition-all glow-purple active:opacity-80"
          >
            무료 홍보영상 만들기
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      <Footer />
    </main>
  );
}
