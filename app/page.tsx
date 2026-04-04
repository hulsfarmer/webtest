'use client';

import Link from 'next/link';
import { ArrowRight, Play, Sparkles, Zap, Globe, DollarSign, Megaphone } from 'lucide-react';
import Header from '@/components/Header';
import HowItWorks from '@/components/HowItWorks';
import PricingSection from '@/components/PricingSection';
import Footer from '@/components/Footer';

const features = [
  {
    icon: <Globe className="w-6 h-6 text-purple-400" />,
    title: '한국어 완벽 지원',
    description: '한국어 특화 AI 스크립트와 자연스러운 한국어 TTS로 완성도 높은 콘텐츠 제작',
  },
  {
    icon: <Zap className="w-6 h-6 text-blue-400" />,
    title: '처음부터 생성',
    description: '기존 영상이 없어도 됩니다. 주제 입력만으로 스크립트부터 완성 영상까지 전부 자동',
  },
  {
    icon: <DollarSign className="w-6 h-6 text-green-400" />,
    title: '경쟁사 대비 저렴',
    description: 'Pictory($99/월)의 절반도 안 되는 가격. 월 $19로 월 30개 쇼츠 제작 가능',
  },
  {
    icon: <Sparkles className="w-6 h-6 text-pink-400" />,
    title: 'Claude AI 스크립트',
    description: '세계 최고 수준의 Claude AI가 시청자를 사로잡는 훅과 핵심 내용을 자동 작성',
  },
];

const stats = [
  { value: '< 2분', label: '영상 1개 생성 시간' },
  { value: '1080×1920', label: '쇼츠 최적화 포맷' },
  { value: '100%', label: '한국어 지원' },
  { value: '$0', label: '시작 비용' },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#0B0A14] text-white">
      <Header />

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-6 overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-purple-600/10 rounded-full blur-[120px]" />
          <div className="absolute top-20 left-1/3 w-[400px] h-[400px] bg-blue-600/8 rounded-full blur-[100px]" />
        </div>

        <div className="relative max-w-5xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300 text-sm font-medium mb-8">
            <Sparkles className="w-3.5 h-3.5" />
            Claude AI 기반 • 한국어 완벽 지원
          </div>

          {/* Headline */}
          <h1 className="text-5xl md:text-7xl font-extrabold leading-tight mb-6">
            유튜브 쇼츠를
            <br />
            <span className="gradient-text">자동으로 만드세요</span>
          </h1>

          <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            주제만 입력하면 AI가 <strong className="text-white">스크립트 → 음성 → 영상</strong>까지
            <br className="hidden md:block" />
            모두 자동으로 완성해드립니다. 클릭 한 번으로.
          </p>

          {/* Service selector cards */}
          <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto mb-10">
            <Link
              href="/generate"
              className="group flex flex-col items-start gap-3 p-6 rounded-2xl bg-white/5 border border-purple-500/20 hover:border-purple-500/50 hover:bg-purple-500/5 transition-all text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="font-bold text-white text-base">유튜브 쇼츠</p>
                  <p className="text-xs text-purple-300">콘텐츠 자동 생성</p>
                </div>
              </div>
              <p className="text-gray-400 text-sm leading-relaxed">주제만 입력하면 AI가 스크립트·음성·영상을 자동으로 완성</p>
              <div className="flex items-center gap-1 text-purple-400 text-sm font-medium group-hover:gap-2 transition-all mt-auto">
                무료로 시작 <ArrowRight className="w-4 h-4" />
              </div>
            </Link>

            <Link
              href="/promo"
              className="group flex flex-col items-start gap-3 p-6 rounded-2xl bg-white/5 border border-emerald-500/20 hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                  <Megaphone className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <p className="font-bold text-white text-base">SNS 홍보 영상</p>
                  <p className="text-xs text-emerald-300">업체 홍보 자동 생성</p>
                </div>
              </div>
              <p className="text-gray-400 text-sm leading-relaxed">업체명·홍보 포인트 입력 → AI가 맞춤 홍보 영상을 30초 만에 제작</p>
              <div className="flex items-center gap-1 text-emerald-400 text-sm font-medium group-hover:gap-2 transition-all mt-auto">
                무료로 시작 <ArrowRight className="w-4 h-4" />
              </div>
            </Link>
          </div>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <a
              href="#how-it-works"
              className="flex items-center gap-2 px-8 py-4 rounded-xl bg-white/5 text-white font-semibold text-lg hover:bg-white/10 transition-all border border-white/10"
            >
              <Play className="w-4 h-4" />
              작동 방식 보기
            </a>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
            {stats.map((stat) => (
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

      {/* Demo preview */}
      <section className="py-12 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="glass-card p-6 md:p-8 rounded-2xl">
            <div className="flex flex-col md:flex-row items-center gap-8">
              {/* Input side */}
              <div className="flex-1 space-y-3">
                <div className="text-gray-400 text-sm font-medium">입력</div>
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-gray-300 text-sm mb-1">주제</div>
                  <div className="text-white font-medium">&quot;다이어트 팁 5가지&quot;</div>
                </div>
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-gray-300 text-sm mb-1">영상 길이</div>
                  <div className="text-white font-medium">60초</div>
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
                  { icon: '📝', label: 'AI 스크립트', color: 'text-purple-400' },
                  { icon: '🎙️', label: '한국어 음성', color: 'text-blue-400' },
                  { icon: '🎬', label: '1080×1920 MP4', color: 'text-green-400' },
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

      {/* Features section */}
      <section className="py-24 px-6 bg-gradient-to-b from-transparent to-purple-950/10">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">
              왜 <span className="gradient-text">ShortsAI</span>인가요?
            </h2>
            <p className="text-gray-400 text-lg">경쟁 서비스들이 못하는 것들</p>
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
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            지금 바로{' '}
            <span className="gradient-text">시작해보세요</span>
          </h2>
          <p className="text-gray-400 text-lg mb-8">
            신용카드 없이 무료로 5개 영상을 만들어보세요
          </p>
          <Link
            href="/generate"
            className="inline-flex items-center gap-2 px-10 py-5 rounded-xl bg-gradient-brand text-white font-bold text-lg hover:opacity-90 transition-all glow-purple"
          >
            무료 영상 만들기
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      <Footer />
    </main>
  );
}
