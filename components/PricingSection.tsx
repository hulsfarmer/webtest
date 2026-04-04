'use client';

import { Check, Zap } from 'lucide-react';
import { useState } from 'react';

const plans = [
  {
    name: '무료',
    nameEn: 'Free',
    price: 0,
    period: '영원히 무료',
    description: '시작해보기 딱 좋아요',
    features: [
      '월 5개 영상',
      '1080×1920 쇼츠 포맷',
      'AI 스크립트 생성',
      '한국어 TTS',
      'MP4 다운로드',
    ],
    cta: '무료로 시작',
    href: '/generate',
    highlighted: false,
    badge: null,
  },
  {
    name: '기본',
    nameEn: 'Basic',
    price: 19,
    period: '월',
    description: '꾸준히 채널을 키우는 분께',
    features: [
      '월 30개 영상',
      '1080×1920 쇼츠 포맷',
      'AI 스크립트 생성',
      '한국어 TTS 고품질',
      'MP4 다운로드',
      '해시태그 자동 추천',
      '이메일 지원',
    ],
    cta: '기본 시작',
    plan: 'basic',
    highlighted: true,
    badge: '인기',
  },
  {
    name: '프로',
    nameEn: 'Pro',
    price: 49,
    period: '월',
    description: '매일 콘텐츠를 올리는 크리에이터',
    features: [
      '무제한 영상',
      '1080×1920 쇼츠 포맷',
      'AI 스크립트 생성',
      '한국어 TTS 프리미엄',
      'MP4 다운로드',
      '해시태그 자동 추천',
      '우선 처리 (빠른 생성)',
      '우선 고객 지원',
    ],
    cta: '프로 시작',
    plan: 'pro',
    highlighted: false,
    badge: null,
  },
];

const competitorComparison = [
  { name: 'Pictory', price: '$23~99/월', weakness: '영어만 지원, 비쌈' },
  { name: 'InVideo', price: '$15~30/월', weakness: '한국어 부족' },
  { name: 'Opus Clip', price: '$15~29/월', weakness: '기존 영상 편집만 가능' },
  { name: 'ShortsAI', price: '$0~49/월', weakness: '한국어 완벽, 처음부터 생성 가능', isUs: true },
];

export default function PricingSection() {
  const [loading, setLoading] = useState<string | null>(null);

  const handleUpgrade = async (plan: string) => {
    if (plan === 'free') {
      window.location.href = '/generate';
      return;
    }

    setLoading(plan);
    try {
      const sessionId = localStorage.getItem('shortsai_session') || 'demo';
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, sessionId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('결제 설정이 필요합니다. .env.local에 Stripe 키를 추가해주세요.');
      }
    } catch {
      alert('결제 처리 중 오류가 발생했습니다.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <section id="pricing" className="py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <div className="inline-block px-4 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-sm font-medium mb-4">
            합리적인 가격
          </div>
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            경쟁사보다{' '}
            <span className="gradient-text">저렴하고 더 좋은</span>
          </h2>
          <p className="text-gray-400 text-lg">한국어 완벽 지원 + 처음부터 쇼츠 생성</p>
        </div>

        {/* Pricing cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative rounded-2xl p-6 border transition-all ${
                plan.highlighted
                  ? 'bg-gradient-to-b from-purple-900/40 to-brand-card border-purple-500/50 glow-purple'
                  : 'bg-brand-card border-white/10 hover:border-purple-500/30'
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-brand text-white text-xs font-bold">
                  {plan.badge}
                </div>
              )}

              <div className="mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-xl font-bold">{plan.name}</h3>
                  <span className="text-gray-500 text-sm">{plan.nameEn}</span>
                </div>
                <p className="text-gray-400 text-sm mb-4">{plan.description}</p>
                <div className="flex items-end gap-1">
                  <span className="text-4xl font-bold">${plan.price}</span>
                  {plan.price > 0 && <span className="text-gray-400 mb-1">/{plan.period}</span>}
                  {plan.price === 0 && <span className="text-gray-400 mb-1 text-sm">{plan.period}</span>}
                </div>
              </div>

              <button
                onClick={() => handleUpgrade(plan.plan || 'free')}
                disabled={loading === plan.plan}
                className={`w-full py-3 rounded-xl font-semibold text-sm mb-6 transition-all ${
                  plan.highlighted
                    ? 'bg-gradient-brand text-white hover:opacity-90'
                    : 'bg-white/10 text-white hover:bg-white/15 border border-white/10'
                } disabled:opacity-50`}
              >
                {loading === plan.plan ? '처리 중...' : plan.cta}
              </button>

              <ul className="space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-3 text-sm text-gray-300">
                    <Check className="w-4 h-4 text-purple-400 flex-shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Competitor comparison */}
        <div className="glass-card p-6">
          <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400" />
            경쟁 서비스 비교
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-2 text-gray-400 font-medium">서비스</th>
                  <th className="text-left py-2 text-gray-400 font-medium">가격</th>
                  <th className="text-left py-2 text-gray-400 font-medium">약점/특징</th>
                </tr>
              </thead>
              <tbody>
                {competitorComparison.map((c) => (
                  <tr
                    key={c.name}
                    className={`border-b border-white/5 ${c.isUs ? 'bg-purple-500/10' : ''}`}
                  >
                    <td className={`py-3 font-medium ${c.isUs ? 'text-purple-400' : 'text-gray-300'}`}>
                      {c.isUs && '✨ '}{c.name}
                    </td>
                    <td className="py-3 text-gray-300">{c.price}</td>
                    <td className={`py-3 ${c.isUs ? 'text-green-400' : 'text-gray-400'}`}>
                      {c.weakness}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Revenue potential */}
        <div className="mt-8 text-center p-6 rounded-2xl bg-gradient-to-r from-purple-900/20 to-blue-900/20 border border-purple-500/20">
          <p className="text-gray-300 text-lg">
            구독자 <span className="text-white font-bold">100명</span>만 모이면 →{' '}
            <span className="gradient-text font-bold text-xl">월 $2,000 ~ $5,000</span>
          </p>
          <p className="text-gray-500 text-sm mt-2">내가 자는 동안에도 서버가 영상을 만들고, 사용자는 돈을 냅니다</p>
        </div>
      </div>
    </section>
  );
}
