import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAuthUrl } from '@/lib/tiktok';
import crypto from 'crypto';

/** 관리자만 연결 시작 → 틱톡 동의 화면으로 리디렉트 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const email = (session?.user?.email || '').toLowerCase();
  const admins = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!email || (admins.length && !admins.includes(email))) {
    return NextResponse.json({ error: '관리자만 연결할 수 있습니다.' }, { status: 403 });
  }
  const state = crypto.randomBytes(16).toString('hex');
  const res = NextResponse.redirect(getAuthUrl(state));
  res.cookies.set('tt_oauth_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' });
  return res;
}

export const dynamic = 'force-dynamic';
