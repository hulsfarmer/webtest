import { NextRequest, NextResponse } from 'next/server';
import { getUsage, resetUsage, PLAN_LIMITS } from '@/lib/usageStore';

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId가 필요합니다.' }, { status: 400 });
  }

  const usage = getUsage(sessionId);
  const limit = PLAN_LIMITS[usage.plan];

  return NextResponse.json({
    plan: usage.plan,
    used: usage.count,
    limit: limit === Infinity ? null : limit,
    remaining: usage.remaining,
    month: usage.month,
  });
}

// DELETE /api/usage?sessionId=xxx  → 해당 세션 한도 리셋
// DELETE /api/usage?all=true       → 전체 리셋
export async function DELETE(req: NextRequest) {
  const all = req.nextUrl.searchParams.get('all');
  const sessionId = req.nextUrl.searchParams.get('sessionId');

  if (all === 'true') {
    resetUsage();
    return NextResponse.json({ ok: true, message: '전체 사용량 리셋 완료' });
  }

  if (sessionId) {
    resetUsage(sessionId);
    return NextResponse.json({ ok: true, message: `세션 ${sessionId} 리셋 완료` });
  }

  return NextResponse.json({ error: 'sessionId 또는 all=true 가 필요합니다.' }, { status: 400 });
}
