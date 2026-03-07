import { NextRequest, NextResponse } from 'next/server';
import { resetUsage } from '@/lib/usageStore';

// DEV ONLY: Reset usage counter
// GET /api/dev/reset-usage            → 전체 초기화
// GET /api/dev/reset-usage?sid=xxxxx  → 특정 세션만 초기화
export async function GET(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get('sid') ?? undefined;
  resetUsage(sid);
  return NextResponse.json({ ok: true, message: sid ? `세션 ${sid} 초기화 완료` : '전체 초기화 완료' });
}
