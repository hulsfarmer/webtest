'use client';

import { Check, Loader2, Clock, X } from 'lucide-react';
import { useState, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useSession } from 'next-auth/react';
import PortOne from '@portone/browser-sdk/v2';

// 국내 결제수단 → PortOne 채널키/빌링수단 매핑 (채널키는 포트원 콘솔에서 발급).
// channelKey(env)가 설정된 수단만 결제창에 노출된다. (네이버페이는 매출이력 요건 충족 후 키 추가)
const ALL_PAY_METHODS = [
  { id: 'toss', label: '토스페이', channelKey: process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY_TOSS, billingKeyMethod: 'EASY_PAY' as const },
  { id: 'kakao', label: '카카오페이', channelKey: process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY_KAKAO, billingKeyMethod: 'EASY_PAY' as const },
  { id: 'naver', label: '네이버페이', channelKey: process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY_NAVER, billingKeyMethod: 'EASY_PAY' as const },
  { id: 'card', label: '신용·체크카드', channelKey: process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY_CARD, billingKeyMethod: 'CARD' as const },
];
// 실제 설정된(채널키 존재) 수단만
const PAY_METHODS = ALL_PAY_METHODS.filter((m) => m.channelKey);

const PLAN_AMOUNT: Record<string, { amount: number; orderName: string }> = {
  pro: { amount: 5500, orderName: 'ShortsAI Pro 월 정기결제' },
  business: { amount: 15950, orderName: 'ShortsAI Business 월 정기결제' },
};

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
    price: 5000,
    priceDisplay: '₩5,000',
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
    variantId: 1409976,
    highlighted: true,
    badge: '인기',
  },
  {
    name: 'Business',
    nameEn: 'Business',
    price: 14500,
    priceDisplay: '₩14,500',
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
    variantId: 1410086,
    highlighted: false,
    badge: null,
  },
];


export default function PricingSection() {
  const { data: session } = useSession();
  const [loading, setLoading] = useState<string | null>(null);
  const [currentPlan, setCurrentPlan] = useState('free');
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null); // 결제수단 선택 모달 대상 플랜

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

  // 플랜 CTA 클릭 → 결제수단 선택 모달 열기
  const handleUpgrade = (planId: string) => {
    if (planId === 'free') {
      window.location.href = session ? '/promo' : '/api/auth/signin';
      return;
    }
    if (!session) {
      window.location.href = '/api/auth/signin';
      return;
    }
    if (!PLAN_AMOUNT[planId]) return;
    if (PAY_METHODS.length === 0) {
      alert('결제 기능이 곧 오픈됩니다. 잠시만 기다려주세요!');
      return;
    }
    setPendingPlan(planId);
  };

  // 구독 해지 — 다음 자동청구 중단(현재 기간은 만료일까지 유지)
  const handleCancel = async () => {
    if (!confirm('정기결제를 해지할까요? 남은 이용기간은 유지되며, 다음 달부터 청구되지 않습니다.')) return;
    try {
      const res = await fetch('/api/payment/portone/cancel', { method: 'POST' });
      const data = await res.json();
      if (data.success) alert('구독이 해지되었습니다. 남은 기간까지는 계속 이용하실 수 있습니다.');
      else alert(data.error || '해지 처리에 실패했습니다.');
    } catch {
      alert('해지 처리 중 오류가 발생했습니다.');
    }
  };

  // 선택한 결제수단으로 PortOne 단건결제 실행 → 서버 검증 → 플랜 반영
  const payWith = async (methodId: string) => {
    const planId = pendingPlan;
    if (!planId) return;
    const method = PAY_METHODS.find((m) => m.id === methodId);
    const target = PLAN_AMOUNT[planId];
    const storeId = process.env.NEXT_PUBLIC_PORTONE_STORE_ID;
    if (!method || !target || !storeId || !method.channelKey) {
      alert('결제가 아직 준비 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    setPendingPlan(null);
    flushSync(() => setLoading(planId));
    try {
      const userId = (session!.user as { id?: string }).id;
      // 1) 빌링키(정기결제 수단) 발급
      const issue = await PortOne.requestIssueBillingKey({
        storeId,
        channelKey: method.channelKey,
        billingKeyMethod: method.billingKeyMethod,
        issueName: target.orderName,
        customer: { customerId: userId },
      });

      if (!issue || issue.code != null) {
        if (issue?.message) alert(issue.message);
        setLoading(null);
        return;
      }

      // 2) 서버에 빌링키 전달 → 첫 달 청구 + 구독 활성화
      const res = await fetch('/api/payment/portone/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingKey: issue.billingKey, plan: planId }),
      });
      const data = await res.json();
      if (data.success) {
        setCurrentPlan(data.plan);
        alert(`${data.plan === 'business' ? 'Business' : 'Pro'} 정기결제가 시작되었습니다!`);
        window.location.href = '/promo';
        return;
      }
      alert(data.error || '결제에 실패했습니다. 결제수단을 확인해주세요.');
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
            <p className="text-white text-lg font-medium">결제 처리 중...</p>
          </div>
        </div>
      )}

      {pendingPlan && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setPendingPlan(null)}
        >
          <div
            className="bg-brand-card border border-white/10 rounded-2xl p-6 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-bold text-white">결제수단 선택</h3>
              <button onClick={() => setPendingPlan(null)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <p className="text-gray-400 text-sm mb-5">
              {pendingPlan === 'business' ? 'Business' : 'Pro'} · 월 ₩
              {PLAN_AMOUNT[pendingPlan]?.amount.toLocaleString()} 정기결제
            </p>
            <div className="space-y-2">
              {PAY_METHODS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => payWith(m.id)}
                  className="w-full py-3 rounded-xl bg-white/10 text-white font-semibold hover:bg-white/15 border border-white/10 transition-all"
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-gray-500 text-xs mt-4 text-center">
              매월 자동결제되며, 언제든 해지할 수 있습니다.
            </p>
          </div>
        </div>
      )}
    <section id="pricing" className="py-16 sm:py-24 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10 sm:mb-16">
          <div className="inline-block px-3 sm:px-4 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs sm:text-sm font-medium mb-4">
            합리적인 가격
          </div>
          <h2 className="text-2xl sm:text-3xl md:text-5xl font-bold mb-3 sm:mb-4">
            영상 제작사보다 <span className="gradient-text">100배 저렴한</span>
          </h2>
          <p className="text-gray-400 text-sm sm:text-lg">사업장 홍보영상, 이제 직접 만드세요</p>

          {/* 할인 배너 */}
          <div className="mt-6 sm:mt-8 inline-flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-2.5 sm:py-3 rounded-2xl bg-gradient-to-r from-red-500/20 to-orange-500/20 border border-red-500/30">
            <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-red-400 animate-pulse shrink-0" />
            <div className="text-left">
              <p className="text-white font-bold text-sm sm:text-lg">오픈 기념 50% 할인 <span className="text-red-400">OPEN50</span></p>
              <p className="text-gray-400 text-xs sm:text-sm">~4/18까지 · 첫 달 50% 할인 자동 적용</p>
            </div>
          </div>
        </div>

        {/* Pricing cards */}
        <div className="grid md:grid-cols-3 gap-4 sm:gap-6 mb-10 sm:mb-16">
          {plans.map((plan) => {
            const isCurrentPlan = currentPlan === plan.planId;
            const planOrder = ['free', 'pro', 'business'];
            const isLowerPlan = planOrder.indexOf(plan.planId) < planOrder.indexOf(currentPlan);

            return (
              <div
                key={plan.name}
                className={`relative rounded-2xl p-4 sm:p-6 border transition-all ${
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

                <div className="mb-4 sm:mb-6">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-lg sm:text-xl font-bold">{plan.name}</h3>
                    {plan.name !== plan.nameEn && (
                      <span className="text-gray-500 text-sm">{plan.nameEn}</span>
                    )}
                  </div>
                  <p className="text-gray-400 text-sm mb-4">{plan.description}</p>
                  <div className="flex items-end gap-1">
                    <span className="text-2xl sm:text-3xl md:text-4xl font-bold">{plan.priceDisplay}</span>
                    <span className="text-gray-400 mb-1 text-sm">{plan.price > 0 ? `/${plan.period}` : plan.period}</span>
                  </div>
                  {plan.price > 0 && (
                    <p className="text-gray-500 text-xs mt-1">부가세(VAT) 별도</p>
                  )}
                </div>

                {isCurrentPlan ? (
                  <div className="mb-6 space-y-2">
                    <button
                      disabled
                      className="w-full py-3 rounded-xl bg-purple-500/20 text-purple-400 text-sm font-semibold cursor-default border border-purple-500/30"
                    >
                      현재 플랜
                    </button>
                    {plan.planId !== 'free' && (
                      <button
                        onClick={handleCancel}
                        className="block w-full py-2 rounded-xl bg-white/5 text-gray-400 text-xs text-center hover:text-white hover:bg-white/10 transition-all"
                      >
                        구독 해지
                      </button>
                    )}
                  </div>
                ) : isLowerPlan ? (
                  <button
                    disabled
                    className="w-full py-3 rounded-xl bg-white/5 text-gray-500 text-sm font-semibold cursor-default mb-6"
                  >
                    현재 플랜보다 낮음
                  </button>
                ) : currentPlan !== 'free' && currentPlan !== 'admin' && portalUrl ? (
                  <div className="mb-6 space-y-2">
                    <a
                      href={portalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full py-3 rounded-xl bg-white/10 text-white text-sm font-semibold text-center hover:bg-white/20 transition-all"
                    >
                      구독 관리에서 변경
                    </a>
                    <p className="text-xs text-gray-500 text-center">현재 구독을 변경하려면 구독 관리 페이지를 이용하세요</p>
                  </div>
                ) : (
                  <button
                    onClick={() => handleUpgrade(plan.planId)}
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

      </div>
    </section>
    </>
  );
}
