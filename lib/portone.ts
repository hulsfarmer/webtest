import type { Plan } from './usageStore';

/**
 * PortOne V2 정기결제(빌링) — 플랜별 월 청구 금액(원) 및 주문명.
 */
export const PORTONE_PLAN_AMOUNT: Record<string, { plan: Plan; amount: number; orderName: string }> = {
  pro: { plan: 'pro', amount: 5500, orderName: 'ShortsAI Pro 월 정기결제' },
  business: { plan: 'business', amount: 15950, orderName: 'ShortsAI Business 월 정기결제' },
};

/** 서버에 PortOne 시크릿이 설정돼 있는지 (없으면 결제 비활성) */
export function isPortOneConfigured(): boolean {
  return !!process.env.PORTONE_API_SECRET;
}

/**
 * 발급된 빌링키로 1회 청구 (첫 결제 및 매월 갱신 크론에서 호출).
 * 성공(2xx) 시 { ok: true }, 실패 시 사유 반환.
 */
export async function chargeBillingKey(
  paymentId: string,
  billingKey: string,
  plan: string,
  customerId: string,
): Promise<{ ok: boolean; error?: string }> {
  const secret = process.env.PORTONE_API_SECRET;
  const target = PORTONE_PLAN_AMOUNT[plan];
  if (!secret || !target) return { ok: false, error: '결제 미설정 또는 잘못된 플랜' };

  try {
    const res = await fetch(
      `https://api.portone.io/payments/${encodeURIComponent(paymentId)}/billing-key`,
      {
        method: 'POST',
        headers: { Authorization: `PortOne ${secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billingKey,
          orderName: target.orderName,
          customer: { id: customerId },
          amount: { total: target.amount },
          currency: 'KRW',
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `PortOne ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `청구 예외: ${String(err).slice(0, 150)}` };
  }
}
