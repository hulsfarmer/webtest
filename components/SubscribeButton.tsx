'use client';

import { useState, ReactNode, CSSProperties } from 'react';
import { useSession } from 'next-auth/react';
import PortOne from '@portone/browser-sdk/v2';

const CARD_CHANNEL_KEY = process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY_CARD;
const PLAN: Record<string, { amount: number; orderName: string }> = {
  lite: { amount: 9900, orderName: 'ShortsAI 라이트(월 55크레딧)' },
  pro: { amount: 19900, orderName: 'ShortsAI 프로(월 110크레딧)' },
};

// 공용 버튼 스타일 (landing/studio 둘 다 정의된 CSS 변수 사용 → 어디서든 톤 일치)
export const btnBase: CSSProperties = { width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'inherit', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', borderRadius: 11, padding: '11px 18px', border: '1px solid transparent' };
export const btnGrad: CSSProperties = { ...btnBase, background: 'var(--grad)', color: '#fff' };
export const btnGhost: CSSProperties = { ...btnBase, background: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border-strong)' };
export const cardStyle: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, display: 'flex', flexDirection: 'column' };
export const featCardStyle: CSSProperties = { ...cardStyle, borderColor: 'var(--purple)', boxShadow: '0 20px 44px -24px rgba(124,58,237,.45)', position: 'relative' };

// 플랜 카드용 — 누르면 폰번호 입력 후 바로 PortOne 카드 정기결제(빌링키) 창.
export default function SubscribeButton({ plan, variant, children }: { plan: 'lite' | 'pro'; variant: 'ghost' | 'grad'; children: ReactNode }) {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(false);

  const go = async () => {
    if (!session) { window.location.href = '/api/auth/signin'; return; }
    if (!CARD_CHANNEL_KEY) { alert('구독 결제가 곧 오픈됩니다. 잠시만 기다려주세요!'); return; }
    const storeId = process.env.NEXT_PUBLIC_PORTONE_STORE_ID;
    const target = PLAN[plan];
    if (!storeId || !target) { alert('결제가 아직 준비 중입니다.'); return; }
    const u = session.user as { id?: string; name?: string; email?: string };
    const phone = (window.prompt('결제 진행을 위해 휴대폰 번호를 입력해주세요.\n(예: 01012345678)') || '').replace(/[^0-9]/g, '');
    if (phone.length < 10) { alert('휴대폰 번호를 정확히 입력해주세요.'); return; }
    setLoading(true);
    try {
      const issue = await PortOne.requestIssueBillingKey({
        storeId, channelKey: CARD_CHANNEL_KEY, billingKeyMethod: 'CARD',
        issueId: `sa-${String(u.id).slice(0, 8)}-${Date.now().toString(36)}`,
        issueName: target.orderName,
        customer: { customerId: u.id, fullName: u.name || '고객', phoneNumber: phone, email: u.email || undefined },
      });
      if (!issue || issue.code != null) { if (issue?.message) alert(issue.message); setLoading(false); return; }
      const res = await fetch('/api/payment/portone/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingKey: issue.billingKey, plan }),
      });
      const data = await res.json();
      if (data.success) { alert('구독이 시작되었습니다! 이번 달 크레딧이 충전됐어요.'); window.location.reload(); return; }
      alert(data.error || '구독 처리에 실패했습니다.');
    } catch (e) {
      alert('구독 처리 중 오류: ' + (e instanceof Error ? e.message : String(e)));
    }
    setLoading(false);
  };

  return <button onClick={go} disabled={loading} style={{ ...(variant === 'grad' ? btnGrad : btnGhost), opacity: loading ? 0.6 : 1 }}>{loading ? '처리 중...' : children}</button>;
}
