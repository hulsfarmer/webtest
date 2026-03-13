import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUsage, resetUsage, PLAN_LIMITS } from '@/lib/usageStore';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const userId = session.user.id;
  const usage = await getUsage(userId);
  const limit = PLAN_LIMITS[usage.plan];

  return NextResponse.json({
    plan: usage.plan,
    used: usage.count,
    limit: limit === Infinity ? null : limit,
    remaining: usage.remaining,
    month: usage.month,
  });
}

// DELETE /api/usage — 현재 사용자 한도 리셋 (dev용)
export async function DELETE(req: NextRequest) {
  const all = req.nextUrl.searchParams.get('all');

  if (all === 'true') {
    await resetUsage();
    return NextResponse.json({ ok: true, message: '전체 사용량 리셋 완료' });
  }

  const session = await getServerSession(authOptions);
  if (session?.user?.id) {
    await resetUsage(session.user.id);
    return NextResponse.json({ ok: true, message: '사용량 리셋 완료' });
  }

  return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
}
