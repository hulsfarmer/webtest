import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { claimFreeCredits } from '@/lib/usageStore';

/** 이번 달 무료 크레딧 쿠폰 받기 (모든 로그인 유저, 월 1회) */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const r = await claimFreeCredits(session.user.id);
  if (r.alreadyClaimed) return NextResponse.json({ error: '이번 달 무료 크레딧은 이미 받으셨어요.', credits: r.credits }, { status: 409 });
  return NextResponse.json({ ok: true, granted: r.granted, credits: r.credits, firstFreeClaim: r.firstFreeClaim });
}

export const dynamic = 'force-dynamic';
