import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { cancelSubscription } from '@/lib/usageStore';

/**
 * 구독 해지: 빌링키를 제거해 다음 자동청구를 중단.
 * 플랜은 이미 결제된 기간(plan_expires_at)까지 유지되다가 만료 시 free로 강등.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id;
  if (!session?.user || !userId) {
    return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
  }

  await cancelSubscription(userId);
  console.log(`[PortOne] 구독 해지 user=${userId} (빌링키 제거, 만료일까지 유지)`);
  return NextResponse.json({ success: true });
}
