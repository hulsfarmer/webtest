import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { verifyPayment, CREDIT_PACKS, isPortOneConfigured } from '@/lib/portone';
import { addCredits } from '@/lib/usageStore';

/**
 * 단건(크레딧) 결제 확정: 프론트에서 PortOne 일반결제 완료 후 paymentId를 전달하면,
 * 서버가 PortOne API로 결제상태·금액을 검증하고 성공 시 크레딧을 충전한다.
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

  const { paymentId, pack } = await request.json();
  const target = CREDIT_PACKS[pack];
  if (!paymentId || !target) {
    return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 });
  }

  const result = await verifyPayment(paymentId, target.amount);
  if (!result.ok) {
    console.error(`[PortOne] 단건 검증 실패 user=${userId} pack=${pack}: ${result.error}`);
    return NextResponse.json({ error: '결제 검증에 실패했습니다. 결제내역을 확인해주세요.' }, { status: 402 });
  }

  await addCredits(userId, target.credits);
  console.log(`[PortOne] 크레딧 충전 user=${userId} +${target.credits} (pack=${pack})`);
  return NextResponse.json({ success: true, credits: target.credits });
}
