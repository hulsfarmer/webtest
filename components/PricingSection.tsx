'use client';

import { Check, Zap, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useSession } from 'next-auth/react';

const plans = [
  {
    name: '무료',
    nameEn: 'Free',
    price: 0,
    priceDisplay: '₩0',
    period: '영원히 무료',
    description: '먼저 체험해보세요',
    features: [
      '월 3회 홍보영상',
      '1080×1920 쇼츠 포맷',
      'AI 홍보 스크립트 생성',
      '한국어 TTS 내레이션',
      'BGM 자동 추천',
      'MP4 다운로드',
    ],
    cta: '무료로 시작',
    planId: 'free',
    variantId: null as number | null,
    highlighted: false,
    badge: null as string | null,
  },
  {
    name: 'Pro',
    nameEn: 'Pro',
    price: 9900,
    priceDisplay: '₩9,900',
    period: '월',
    description: '매달 꾸준히 홍보하는 사장님께',
    features: [
      '월 30회 홍보영상',
      '워터마크 없음',
      '모든 나래이터 (Chirp3-HD + Neural2)',
      '모든 BGM + 커스텀 BGM',
      '고급 음성 속도 조절',
      'MP4 다운로드',
      '이메일 지원',
    ],
    cta: 'Pro 시작',
    planId: 'pro',
    variantId: 1405743,
    highlighted: true,
    badge: '인기',
  },
  {
    name: 'Business',
    nameEn: 'Business',
    price: 29000,
    priceDisplay: '₩29,000',
    period: '월',
    description: '여러 매장을 운영하거나 매일 홍보하는 분께',
    features: [
      '월 100회 홍보영상',
      '워터마크 없음',
      '모든 나래이터 (Chirp3-HD + Neural2)',
      '모든 BGM + 커스텀 BGM',
      '고급 음성 속도 조절',
      'MP4 다운로드',
      '우선 처리 (빠른 생성)',
      '우선 고객 지원',
    ],
    cta: 'Business 시작',
    planId: 'business',
    variantId: 1405749,
    highlighted: false,
    badge: null,
  },
];

const competitorComparison = [
  { name: '영상 제작 의뢰', price: '50~100만원/건', weakness: '비용 높음, 수정 어려움' },
  { name: 'Pictory', price: '$23~99/월', weakness: '영어만 지원' },
  { name: 'InVideo', price: '$15~30/월', weakness: '한국어 부족, 홍보 특화 아님' },
  { name: 'ShortsAI', price: '₩0~29,000/월', weakness: '한국어 완벽, 사업장 홍보 특화', isUs: true },
];

export default function PricingSection() {
  const { data: session } = useSession();
  const [loading, setLoading] = useState<string | null>(null);
  const [currentPlan, setCurrentPlan] = useState('free');
  const [portalUrl, setPortalUrl] = useState<string | null>(null);

  useEffect(() => {
    if (session?.user) {
      fetch('/api/usage')
        .then(r => r.json())
        .then(d => setCurrentPlan(d.plan || 'free'))
        .catch(() => {});
      fetch('/api/subscription')
        .then(r => r.json())
        .then(d => setPortalUrl(d.portalUrl || null))
        .catch(() => {});
    }
  }, [session]);

  const handleUpgrade = async (planId: string, variantId: number | null) => {
    if (planId === 'free') {
      window.location.href = session ? '/promo' : '/api/auth/signin';
      return;
    }

    if (!session) {
      window.location.href = '/api/auth/signin';
      return;
    }

    if (!variantId) return;

    flushSync(() => setLoading(planId));
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return; // 로딩 오버레이 유지한 채 이동
      } else {
        alert('결제 페이지를 열 수 없습니다.');
      }
    } catch {
      alert('결제 처리 중 오류가 발생했습니다.');
    }
    setLoading(null);
  };

  return (
    <>
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <Loader2 size={40} className="animate-spin text-purple-400" />
            <p className="text-white text-lg font-medium">결제 페이지로 이동 중...</p>
          </div>
        </div>
      )}
    <section id="pricing" className="py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <div className="inline-block px-4 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-sm font-medium mb-4">
            합리적인 가격
          </div>
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            영상 제작사보다{' '}
            <span className="gradient-text">100배 저렴한</span>
          </h2>
          <p className="text-gray-400 text-lg">사업장 홍보영상, 이제 직접 만드세요</p>
        </div>

        {/* Pricing cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {plans.map((plan) => {
            const isCurrentPlan = currentPlan === plan.planId;
            const planOrder = ['free', 'pro', 'business'];
            const isLowerPlan = planOrder.indexOf(plan.planId) < planOrder.indexOf(currentPlan);

            return (
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
                    {plan.name !== plan.nameEn && (
                      <span className="text-gray-500 text-sm">{plan.nameEn}</span>
                    )}
                  </div>
                  <p className="text-gray-400 text-sm mb-4">{plan.description}</p>
                  <div className="flex items-end gap-1">
                    <span className="text-4xl font-bold">{plan.priceDisplay}</span>
                    {plan.price > 0 && <span className="text-gray-400 mb-1">/{plan.period}</span>}
                    {plan.price === 0 && <span className="text-gray-400 mb-1 text-sm">{plan.period}</span>}
                  </div>
                </div>

                {isCurrentPlan ? (
                  <div className="mb-6 space-y-2">
                    <button
                      disabled
                      className="w-full py-3 rounded-xl bg-purple-500/20 text-purple-400 text-sm font-semibold cursor-default border border-purple-500/30"
                    >
                      현재 플랜
                    </button>
                    {portalUrl && plan.planId !== 'free' && (
                      <a
                        href={portalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full py-2 rounded-xl bg-white/5 text-gray-400 text-xs text-center hover:text-white hover:bg-white/10 transition-all"
                      >
                        구독 관리
                      </a>
                    )}
                  </div>
                ) : isLowerPlan ? (
                  <button
                    disabled
                    className="w-full py-3 rounded-xl bg-white/5 text-gray-500 text-sm font-semibold cursor-default mb-6"
                  >
                    현재 플랜보다 낮음
                  </button>
                ) : (
                  <button
                    onClick={() => handleUpgrade(plan.planId, plan.variantId)}
                    disabled={loading !== null}
                    className={`w-full py-3 rounded-xl font-semibold text-sm mb-6 transition-all ${
                      plan.highlighted
                        ? 'bg-gradient-brand text-white hover:opacity-90'
                        : 'bg-white/10 text-white hover:bg-white/15 border border-white/10'
                    } disabled:opacity-50`}
                  >
                    {loading === plan.planId ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 size={16} className="animate-spin" />
                        처리 중...
                      </span>
                    ) : (
                      plan.cta
                    )}
                  </button>
                )}

                <ul className="space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-3 text-sm text-gray-300">
                      <Check className="w-4 h-4 text-purple-400 flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {/* Competitor comparison */}
        <div className="glass-card p-6">
          <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400" />
            비용 비교
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-2 text-gray-400 font-medium">방법</th>
                  <th className="text-left py-2 text-gray-400 font-medium">가격</th>
                  <th className="text-left py-2 text-gray-400 font-medium">특징</th>
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
      </div>
    </section>
    </>
  );
}
