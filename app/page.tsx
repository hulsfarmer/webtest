'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { ArrowRight, Play, Sparkles, Zap, Globe, DollarSign, Store, Camera, Music, Clock, MonitorPlay } from 'lucide-react';
import Header from '@/components/Header';
import HowItWorks from '@/components/HowItWorks';
import PricingSection from '@/components/PricingSection';
import Footer from '@/components/Footer';

const features = [
  {
    icon: <Store className="w-6 h-6 text-emerald-400" />,
    title: '사업장 맞춤 영상',
    description: '카페, 식당, 헬스장, 미용실 등 업종별 최적화된 홍보 영상을 자동으로 제작',
  },
  {
    icon: <Camera className="w-6 h-6 text-blue-400" />,
    title: '사진만 올리면 끝',
    description: '매장 사진을 올리면 AI가 분석해서 어울리는 홍보 스크립트와 영상을 자동 생성',
  },
  {
    icon: <Music className="w-6 h-6 text-pink-400" />,
    title: 'BGM 자동 추천',
    description: '업종과 분위기에 맞는 배경음악을 자동으로 선택해서 완성도 높은 영상 완성',
  },
  {
    icon: <DollarSign className="w-6 h-6 text-green-400" />,
    title: '영상 제작 비용 절감',
    description: '전문 영상 제작 의뢰(50~100만원) 대비 월 19,900원으로 매달 새 영상 제작',
  },
];

const staticStats = [
  { value: '< 3분', label: '영상 1개 생성 시간' },
  { value: '쇼츠 HD', label: '1080×1920 포맷' },
  { value: '100%', label: '한국어 지원' },
  { value: '₩0', label: '시작 비용' },
];

const businessTypes = ['카페', '식당', '헬스장', '미용실', '네일샵', '꽃집', '베이커리', '학원'];

const headlineTexts = [
  '우리 가게 홍보영상',
  '매매 주택 홍보영상',
  '우리 회사 홍보영상',
  '우리 학교 홍보영상',
  '우리 농장 홍보영상',
];

export default function HomePage() {
  const [headlineIndex, setHeadlineIndex] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setHeadlineIndex((prev) => (prev + 1) % headlineTexts.length);
        setFade(true);
      }, 400);
    }, 3000);
    return () => clearInterval(interval);
  }, []);
  return (
    <main className="min-h-screen bg-[#0B0A14] text-white">
      <Header />

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-6 overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-emerald-600/10 rounded-full blur-[120px]" />
          <div className="absolute top-20 left-1/3 w-[400px] h-[400px] bg-purple-600/8 rounded-full blur-[100px]" />
        </div>

        <div className="relative max-w-5xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm font-medium mb-8">
            <Sparkles className="w-3.5 h-3.5" />
            AI 기반 사업장 홍보영상 자동 생성
          </div>

          {/* Headline */}
          <h1 className="text-4xl md:text-7xl font-extrabold leading-tight mb-6">
            <span
              className={`inline-block transition-all duration-400 ${fade ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}
            >
              {headlineTexts[headlineIndex]}
            </span>
            <br />
            <span className="gradient-text">고화질 3분 완성!</span>
          </h1>

          <p className="text-lg text-gray-300 mb-6 font-medium">
            업종 상관없이 누구나 전문가급 홍보영상 · 한국어 완벽 지원
          </p>

          <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            업체명과 사진만 입력하면 <strong className="text-white">스크립트 → 음성 → BGM → 영상</strong>까지
            <br className="hidden md:block" />
            모두 자동으로 완성. 전문 영상 제작사 없이도 SNS 홍보 쇼츠 완성.
          </p>

          {/* Single CTA */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10">
            <Link
              href="/promo"
              className="inline-flex items-center gap-2 px-8 py-4 md:px-10 md:py-5 rounded-xl bg-gradient-brand text-white font-bold text-base md:text-lg hover:opacity-90 transition-all glow-purple"
            >
              무료로 홍보영상 만들기
              <ArrowRight className="w-5 h-5" />
            </Link>
            <a
              href="#how-it-works"
              className="flex items-center gap-2 px-8 py-4 rounded-xl bg-white/5 text-white font-semibold text-lg hover:bg-white/10 transition-all border border-white/10"
            >
              <Play className="w-4 h-4" />
              작동 방식 보기
            </a>
          </div>

          {/* Business type pills */}
          <div className="mb-12">
            <p className="text-gray-500 text-sm mb-3">이런 업종에 딱 맞습니다</p>
            <div className="flex flex-wrap justify-center gap-2">
              {businessTypes.map((type) => (
                <span
                  key={type}
                  className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-gray-300 text-sm hover:border-emerald-500/40 transition-colors cursor-default"
                >
                  {type}
                </span>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
            {staticStats.map((stat) => (
              <div
                key={stat.label}
                className="glass-card p-4 text-center hover:border-purple-500/30 transition-colors"
              >
                <div className="text-2xl font-bold gradient-text">{stat.value}</div>
                <div className="text-gray-400 text-xs mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sample Videos */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-3">
            실제 생성된 <span className="gradient-text">홍보영상</span>
          </h2>
          <p className="text-gray-400 mb-8">AI가 자동으로 만든 실제 홍보영상입니다</p>
          <div className="flex flex-col sm:flex-row gap-6 justify-center items-center">
            {['/sample/demo.mp4', '/sample/demo2.mp4', '/sample/demo3.mp4'].map((src) => (
              <div key={src} className="glass-card p-3 rounded-2xl w-full max-w-xs">
                <video
                  src={src}
                  controls
                  playsInline
                  preload="metadata"
                  className="w-full rounded-xl aspect-[9/16]"
                />
              </div>
            ))}
          </div>
          <p className="text-gray-500 text-sm mt-4">
            업체명과 사진만 입력 → 3분 만에 이런 영상이 완성됩니다
          </p>
        </div>
      </section>

      {/* Demo preview */}
      <section className="py-12 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="glass-card p-6 md:p-8 rounded-2xl">
            <div className="flex flex-col md:flex-row items-center gap-8">
              {/* Input side */}
              <div className="flex-1 space-y-3">
                <div className="text-gray-400 text-sm font-medium">입력</div>
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-gray-300 text-sm mb-1">업체명</div>
                  <div className="text-white font-medium">&quot;카페 봄날&quot;</div>
                </div>
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-gray-300 text-sm mb-1">홍보 포인트</div>
                  <div className="text-white font-medium">&quot;직접 로스팅한 원두, 한옥 인테리어&quot;</div>
                </div>
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-gray-300 text-sm mb-1">매장 사진</div>
                  <div className="text-white font-medium flex items-center gap-2">
                    <Camera className="w-4 h-4 text-emerald-400" /> 4~5장 업로드
                  </div>
                </div>
              </div>

              {/* Arrow */}
              <div className="flex items-center justify-center">
                <div className="px-4 py-2 rounded-full bg-gradient-brand text-white text-sm font-bold animate-pulse-slow">
                  AI 생성
                </div>
              </div>

              {/* Output side */}
              <div className="flex-1 space-y-3">
                <div className="text-gray-400 text-sm font-medium">출력</div>
                {[
                  { icon: '📝', label: '홍보 스크립트', color: 'text-purple-400' },
                  { icon: '🎙️', label: '한국어 내레이션', color: 'text-blue-400' },
                  { icon: '🎵', label: '업종 맞춤 BGM', color: 'text-pink-400' },
                  { icon: '🎬', label: '홍보 쇼츠 MP4', color: 'text-green-400' },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center gap-3 bg-white/5 rounded-xl p-3 border border-white/10"
                  >
                    <span className="text-2xl">{item.icon}</span>
                    <span className={`font-medium ${item.color}`}>{item.label} 완성</span>
                    <span className="ml-auto text-green-400 text-xs">✓</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <HowItWorks />

      {/* How to Use Video */}
      <section className="py-16 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm font-medium mb-6">
            <MonitorPlay className="w-3.5 h-3.5" />
            실제 사용 영상
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-3">
            이렇게 쉽게 <span className="gradient-text">만들어집니다</span>
          </h2>
          <p className="text-gray-400 mb-8">ShortsAI로 홍보영상 만드는 전체 과정을 확인하세요</p>
          <div className="glass-card p-4 rounded-2xl max-w-2xl mx-auto">
            <video
              src="/sample/how-to-use.mp4"
              controls
              playsInline
              preload="metadata"
              className="w-full rounded-xl"
            />
          </div>
          <p className="text-gray-500 text-sm mt-4">
            업체명 입력부터 완성 영상 다운로드까지, 단 3분이면 충분합니다
          </p>
        </div>
      </section>

      {/* Features section */}
      <section className="py-24 px-6 bg-gradient-to-b from-transparent to-purple-950/10">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              왜 <span className="gradient-text">ShortsAI</span>인가요?
            </h2>
            <p className="text-gray-400 text-lg">사장님을 위한 가장 쉬운 홍보 영상 솔루션</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="glass-card p-6 hover:border-purple-500/40 transition-all group"
              >
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-xl bg-white/5 group-hover:bg-white/10 transition-colors">
                    {feature.icon}
                  </div>
                  <div>
                    <h3 className="font-bold text-lg mb-2">{feature.title}</h3>
                    <p className="text-gray-400 text-sm leading-relaxed">{feature.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <PricingSection />

      {/* Final CTA */}
      <section className="py-24 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl md:text-5xl font-bold mb-6">
            지금 바로 <span className="gradient-text">시작해보세요</span>
          </h2>
          <p className="text-gray-400 text-lg mb-8">
            신용카드 없이 무료로 3개 홍보영상을 만들어보세요
          </p>
          <Link
            href="/promo"
            className="inline-flex items-center gap-2 px-10 py-5 rounded-xl bg-gradient-brand text-white font-bold text-lg hover:opacity-90 transition-all glow-purple"
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
