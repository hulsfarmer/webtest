import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { resetUsage } from '@/lib/usageStore';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);

// Admin only: Reset usage counter
// GET /api/dev/reset-usage            → 전체 초기화
// GET /api/dev/reset-usage?sid=xxxxx  → 특정 세션만 초기화
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !ADMIN_EMAILS.includes(session.user.email)) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const sid = req.nextUrl.searchParams.get('sid') ?? undefined;
  resetUsage(sid);
  return NextResponse.json({ ok: true, message: sid ? `세션 ${sid} 초기화 완료` : '전체 초기화 완료' });
}
