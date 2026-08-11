'use client';

import { Loader2, X } from 'lucide-react';
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
  lite: { amount: 2000, orderName: 'ShortsAI Lite(10회) 월 정기결제' },
  pro: { amount: 4000, orderName: 'ShortsAI Pro(30회) 월 정기결제' },
  business: { amount: 10000, orderName: 'ShortsAI Business(100회) 월 정기결제' },
};

// 단건(크레딧) 팩 — PortOne 일반결제(requestPayment). 채널키 설정 시에만 노출.
const ONETIME_CHANNEL_KEY = process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY_ONETIME;
const CREDIT_PACKS = [
  { id: 'credit10', label: '10회 이용권', credits: 10, amount: 3000, badge: null as string | null },
  { id: 'credit30', label: '30회 이용권', credits: 30, amount: 5000, badge: '인기' as string | null },
];

const plans = [
  {
    name: 'Lite',
    nameEn: 'Lite',
    price: 2000,
    priceDisplay: '₩2,000',
    period: '월',
    description: '가볍게 시작하는 사장님께',
    features: [
      '월 10회 홍보영상',
      '워터마크 없음',
      '모든 나래이터 (Chirp3-HD + Neural2)',
      '모든 BGM + 커스텀 BGM',
      'MP4 다운로드',
    ],
    cta: 'Lite 시작',
    planId: 'lite',
    variantId: null as number | null,
    highlighted: false,
    badge: null as string | null,
  },
  {
    name: 'Pro',
    nameEn: 'Pro',
    price: 4000,
    priceDisplay: '₩4,000',
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
    highlighted: false,
    badge: null,
  },
  {
    name: 'Business',
    nameEn: 'Business',
    price: 10000,
    priceDisplay: '₩10,000',
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
  const [phone, setPhone] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [pendingCredit, setPendingCredit] = useState<string | null>(null);
  useEffect(() => {
    const u = session?.user as { name?: string; email?: string } | undefined;
    if (u?.name) setBuyerName((v) => v || (u.name as string));
    if (u?.email) setBuyerEmail((v) => v || (u.email as string));
  }, [session]);

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

    const phoneDigits = phone.replace(/[^0-9]/g, '');
    if (!buyerName.trim()) {
      alert('이름을 입력해주세요.');
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyerEmail.trim())) {
      alert('이메일을 정확히 입력해주세요.');
      return;
    }
    if (phoneDigits.length < 10) {
      alert('휴대폰 번호를 정확히 입력해주세요.');
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
        issueId: `sa-${String(userId).slice(0, 8)}-${Date.now().toString(36)}`,
        issueName: target.orderName,
        customer: {
          customerId: userId,
          fullName: buyerName.trim(),
          phoneNumber: phoneDigits,
          email: buyerEmail.trim(),
        },
      });

      if (!issue || issue.code != null) {
        console.error("[PortOne] billingkey issue failed:", issue);
        alert(issue?.message ? `[${issue.code}] ${issue.message}` : "billingkey issue failed (no response)");
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
    } catch (e) {
      console.error('[PortOne] payment exception:', e);
      alert('payment error: ' + (e instanceof Error ? e.message : String(e)));
    }
    setLoading(null);
  };

  // 단건(크레딧) 결제 — PortOne 일반결제(requestPayment) → 서버 검증 → 크레딧 충전
  const payOnce = async () => {
    const packId = pendingCredit;
    if (!packId) return;
    const pack = CREDIT_PACKS.find((p) => p.id === packId);
    const storeId = process.env.NEXT_PUBLIC_PORTONE_STORE_ID;
    if (!pack || !storeId || !ONETIME_CHANNEL_KEY) {
      alert('결제가 아직 준비 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    const phoneDigits = phone.replace(/[^0-9]/g, '');
    if (!buyerName.trim()) { alert('이름을 입력해주세요.'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyerEmail.trim())) { alert('이메일을 정확히 입력해주세요.'); return; }
    if (phoneDigits.length < 10) { alert('휴대폰 번호를 정확히 입력해주세요.'); return; }

    setPendingCredit(null);
    flushSync(() => setLoading(packId));
    try {
      const userId = (session!.user as { id?: string }).id;
      const paymentId = `sao-${String(userId).slice(0, 8)}-${Date.now().toString(36)}`;
      const payment = await PortOne.requestPayment({
        storeId,
        channelKey: ONETIME_CHANNEL_KEY,
        paymentId,
        orderName: pack.label,
        totalAmount: pack.amount,
        currency: 'KRW',
        payMethod: 'CARD',
        customer: {
          customerId: userId,
          fullName: buyerName.trim(),
          phoneNumber: phoneDigits,
          email: buyerEmail.trim(),
        },
      });
      if (!payment || payment.code != null) {
        if (payment?.message) alert(payment.message);
        setLoading(null);
        return;
      }
      const res = await fetch('/api/payment/portone/pay-once', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, pack: packId }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`${pack.credits}회 이용권이 충전되었습니다!`);
        window.location.href = '/promo';
        return;
      }
      alert(data.error || '결제 검증에 실패했습니다.');
    } catch (e) {
      console.error('[PortOne] 단건 결제 예외:', e);
      alert('결제 처리 중 오류: ' + (e instanceof Error ? e.message : String(e)));
    }
    setLoading(null);
  };

  const handleBuyCredit = (packId: string) => {
    if (!session) { window.location.href = '/api/auth/signin'; return; }
    if (!ONETIME_CHANNEL_KEY) { alert('단건 결제가 곧 오픈됩니다. 잠시만 기다려주세요!'); return; }
    setPendingCredit(packId);
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
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-gray-300 text-sm mb-1.5">이름</label>
                <input
                  type="text"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  placeholder="홍길동"
                  className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-gray-300 text-sm mb-1.5">이메일</label>
                <input
                  type="email"
                  value={buyerEmail}
                  onChange={(e) => setBuyerEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-gray-300 text-sm mb-1.5">휴대폰 번호</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="01012345678"
                  className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                />
              </div>
              <p className="text-gray-500 text-xs">결제 영수증 발급을 위해 필요합니다.</p>
            </div>
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

      {pendingCredit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setPendingCredit(null)}
        >
          <div
            className="bg-brand-card border border-white/10 rounded-2xl p-6 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-bold text-white">이용권 구매</h3>
              <button onClick={() => setPendingCredit(null)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <p className="text-gray-400 text-sm mb-5">
              {CREDIT_PACKS.find((p) => p.id === pendingCredit)?.credits}회 이용권 · ₩
              {CREDIT_PACKS.find((p) => p.id === pendingCredit)?.amount.toLocaleString()} · 구매일로부터 3개월 이내 사용 (1회 결제)
            </p>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-gray-300 text-sm mb-1.5">이름</label>
                <input type="text" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="홍길동" className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500" />
              </div>
              <div>
                <label className="block text-gray-300 text-sm mb-1.5">이메일</label>
                <input type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} placeholder="you@example.com" className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500" />
              </div>
              <div>
                <label className="block text-gray-300 text-sm mb-1.5">휴대폰 번호</label>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01012345678" className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500" />
              </div>
              <p className="text-gray-500 text-xs">결제 영수증 발급을 위해 필요합니다.</p>
            </div>
            <button onClick={payOnce} className="w-full py-3 rounded-xl bg-gradient-brand text-white font-semibold hover:opacity-90 transition-all">
              결제하기
            </button>
            <p className="text-gray-500 text-xs mt-4 text-center">
              자동갱신 없이 구매한 횟수만큼 사용합니다.
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

        </div>

        {/* 필요한 만큼만 이용 (무료 + 단건 크레딧) */}
        <div className="max-w-3xl mx-auto mb-12 sm:mb-16">
          <div className="text-center mb-6">
            <h3 className="text-xl sm:text-2xl font-bold mb-2">필요한 만큼만 이용</h3>
            <p className="text-gray-400 text-sm">구독 없이 횟수만. 자동결제 없음 · 카드/간편결제</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-2xl p-5 border bg-brand-card border-white/10 text-center">
              <div className="text-lg font-bold mb-1">무료</div>
              <div className="text-2xl sm:text-3xl font-bold mb-1">3회</div>
              <p className="text-gray-500 text-xs mb-4">가입 시 3회 무료 제공</p>
              <button
                onClick={() => handleUpgrade('free')}
                className="w-full py-3 rounded-xl font-semibold text-sm bg-white/10 text-white hover:bg-white/15 border border-white/10 transition-all"
              >
                무료로 시작
              </button>
            </div>
            {CREDIT_PACKS.map((p) => (
              <div key={p.id} className={`relative rounded-2xl p-5 border transition-all text-center ${
                p.badge
                  ? 'bg-gradient-to-b from-purple-900/40 to-brand-card border-purple-500/50 glow-purple'
                  : 'bg-brand-card border-white/10 hover:border-purple-500/30'
              }`}>
                {p.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-brand text-white text-xs font-bold">
                    {p.badge}
                  </div>
                )}
                <div className="text-lg font-bold mb-1">{p.credits}회 이용권</div>
                <div className="text-2xl sm:text-3xl font-bold mb-1">₩{p.amount.toLocaleString()}</div>
                <p className="text-gray-500 text-xs mb-4">부가세(VAT) 포함 · 영상 {p.credits}개 · 유효기간 3개월</p>
                <button
                  onClick={() => handleBuyCredit(p.id)}
                  disabled={loading !== null}
                  className="w-full py-3 rounded-xl font-semibold text-sm bg-white/10 text-white hover:bg-white/15 border border-white/10 transition-all disabled:opacity-50"
                >
                  {loading === p.id ? (
                    <span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" />처리 중...</span>
                  ) : '구매하기'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 구독 (매달 자동, 더 저렴) */}
        <div className="max-w-3xl mx-auto mb-10 sm:mb-16">
          <div className="text-center mb-6">
            <h3 className="text-xl sm:text-2xl font-bold mb-2">매달 자동, 더 저렴한 구독</h3>
            <p className="text-gray-400 text-sm">자주 만든다면 구독이 영상당 훨씬 저렴합니다</p>
          </div>
          {/* Pricing cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const isCurrentPlan = currentPlan === plan.planId;
            const planOrder = ['free', 'lite', 'pro', 'business'];
            const isLowerPlan = planOrder.indexOf(plan.planId) < planOrder.indexOf(currentPlan);

            return (
              <div
                key={plan.name}
                className={`relative rounded-2xl p-5 border transition-all text-center ${
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

                <div className="mb-4">
                  <div className="text-lg font-bold mb-1">{plan.name}</div>
                  <div className="text-2xl sm:text-3xl font-bold mb-1">
                    {plan.priceDisplay}
                    <span className="text-gray-400 text-sm font-normal">/{plan.period}</span>
                  </div>
                  <p className="text-gray-500 text-xs">{plan.features[0]} · 부가세 포함</p>
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

              </div>
            );
          })}
          </div>
        </div>

      </div>
    </section>
    </>
  );
}
