import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from './auth';
import { isAdminEmail } from './admin';

// API 라우트용 관리자 가드 — 관리자가 아니면 403 응답 반환, 관리자면 null.
export async function adminGuard(): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: '관리자 전용 기능입니다.' }, { status: 403 });
  }
  return null;
}
