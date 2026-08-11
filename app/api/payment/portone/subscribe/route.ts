import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { chargeBillingKey, PORTONE_PLAN_AMOUNT, isPortOneConfigured } from '@/lib/portone';
import { startSubscription } from '@/lib/usageStore';

/**
 * 정기결제 시작: 프론트에서 발급한 billingKey로 첫 달을 즉시 청구하고,
 * 성공하면 플랜 활성화 + 빌링키 저장(이후 매월 크론이 자동청구).
 */
export async function POST(request: NextRequest) {
  if (!isPortOneConfigured()) {
    return NextResponse.json({ error: '결제가 아직 설정되지 않았습니다.' }, { status: 503 });
  }

  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id;
  if (!session?.user || !userId) {
    return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
  }

  const { billingKey, plan } = await request.json();
  const target = PORTONE_PLAN_AMOUNT[plan];
  if (!billingKey || !target) {
    return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 });
  }

  const paymentId = `sa-${String(userId).slice(0, 8)}-${Date.now().toString(36)}`;
  const result = await chargeBillingKey(paymentId, billingKey, plan, userId);
  if (!result.ok) {
    console.error(`[PortOne] 첫 결제 실패 user=${userId} plan=${plan}: ${result.error}`);
    return NextResponse.json({ error: '결제에 실패했습니다. 카드/결제수단을 확인해주세요.' }, { status: 402 });
  }

  await startSubscription(userId, target.plan, billingKey);
  console.log(`[PortOne] 구독 시작 user=${userId} → ${target.plan} (billingKey 저장)`);
  return NextResponse.json({ success: true, plan: target.plan });
}
