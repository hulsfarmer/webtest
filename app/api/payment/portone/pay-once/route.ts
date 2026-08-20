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

  const { paymentId, pack, credits: rawCredits } = await request.json();
  // 커스텀 크레딧(≥10, 10크레딧=2,000원=크레딧당 200원) 우선, 없으면 레거시 팩
  let credits: number, amount: number;
  if (typeof rawCredits === 'number' && Number.isFinite(rawCredits)) {
    credits = Math.floor(rawCredits);
    if (credits < 10 || credits > 2000) return NextResponse.json({ error: '크레딧은 10개 이상 2000개 이하로 선택해주세요.' }, { status: 400 });
    amount = credits * 200;
  } else if (pack && CREDIT_PACKS[pack]) {
    credits = CREDIT_PACKS[pack].credits; amount = CREDIT_PACKS[pack].amount;
  } else {
    return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 });
  }
  if (!paymentId) return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 });

  const result = await verifyPayment(paymentId, amount);
  if (!result.ok) {
    console.error(`[PortOne] 단건 검증 실패 user=${userId} credits=${credits}: ${result.error}`);
    return NextResponse.json({ error: '결제 검증에 실패했습니다. 결제내역을 확인해주세요.' }, { status: 402 });
  }

  await addCredits(userId, credits);
  console.log(`[PortOne] 크레딧 충전 user=${userId} +${credits}`);
  return NextResponse.json({ success: true, credits });
}
