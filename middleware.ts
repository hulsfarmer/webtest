import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// 관리자 전용 경로 (제품 홍보영상 단독 페이지 등). 업체/행사(/promo)는 로그인만.
const ADMIN_ONLY = ['/promo-character'];

export async function middleware(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', req.url);
    return NextResponse.redirect(loginUrl);
  }

  const path = req.nextUrl.pathname;
  if (ADMIN_ONLY.some((p) => path === p || path.startsWith(p + '/'))) {
    const email = String(token.email || '').toLowerCase();
    if (!ADMIN_EMAILS.includes(email)) {
      return NextResponse.redirect(new URL('/studio', req.url));
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/promo/:path*', '/promo-character/:path*', '/admin/:path*'],
};
