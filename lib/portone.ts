import type { Plan } from './usageStore';

/**
 * PortOne V2 정기결제(빌링) — 구독 플랜별 월 청구 금액(원, VAT 포함) 및 주문명.
 */
export const PORTONE_PLAN_AMOUNT: Record<string, { plan: Plan; amount: number; credits: number; orderName: string }> = {
  lite: { plan: 'lite', amount: 9900, credits: 55, orderName: 'ShortsAI 라이트(월 55크레딧)' },
  pro: { plan: 'pro', amount: 19900, credits: 110, orderName: 'ShortsAI 프로(월 110크레딧)' },
};

/**
 * 단건(크레딧) 팩 — 1회 결제로 크레딧 잔액 충전(안 만료). 금액은 VAT 포함 실청구가. 크레딧당 200원.
 */
export const CREDIT_PACKS: Record<string, { credits: number; amount: number; orderName: string }> = {
  credit10: { credits: 10, amount: 2000, orderName: 'ShortsAI 10크레딧' },
  credit25: { credits: 25, amount: 5000, orderName: 'ShortsAI 25크레딧' },
  credit60: { credits: 60, amount: 12000, orderName: 'ShortsAI 60크레딧' },
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

/**
 * 단건 결제 검증 — 프론트에서 결제 완료된 paymentId를 서버가 PortOne에 조회해
 * 실제 결제상태(PAID)와 금액이 기대값과 일치하는지 확인(위변조 방지).
 */
export async function verifyPayment(
  paymentId: string,
  expectedAmount: number,
): Promise<{ ok: boolean; error?: string }> {
  const secret = process.env.PORTONE_API_SECRET;
  if (!secret) return { ok: false, error: '결제 미설정' };

  try {
    const res = await fetch(
      `https://api.portone.io/payments/${encodeURIComponent(paymentId)}`,
      { headers: { Authorization: `PortOne ${secret}` } },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `PortOne ${res.status}: ${body.slice(0, 200)}` };
    }
    const payment = await res.json();
    const status = payment?.status;
    const paidTotal = payment?.amount?.total;
    if (status !== 'PAID') {
      return { ok: false, error: `결제 상태 비정상: ${status}` };
    }
    if (typeof paidTotal !== 'number' || paidTotal !== expectedAmount) {
      return { ok: false, error: `금액 불일치: 결제 ${paidTotal} ≠ 기대 ${expectedAmount}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `검증 예외: ${String(err).slice(0, 150)}` };
  }
}
