import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// 관리자 전용 경로. 제품 홍보영상(신규)·로고는 공개(로그인만) → 여기 비움.
const ADMIN_ONLY: string[] = [];

// 로그인 필요 경로(기존 동작 유지). 아래 MAINT 게이트는 이보다 넓은 범위를 막는다.
const AUTH_PREFIXES = ['/promo', '/promo-character', '/admin'];

// 리모델링(점검) 중 접근 차단할 제작 도구 전체.
const MAINT_PREFIXES = ['/studio', '/promo', '/promo-character', '/character', '/history'];

const matchesPrefix = (path: string, prefixes: string[]) =>
  prefixes.some((p) => path === p || path.startsWith(p + '/'));

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const inMaint = process.env.MAINTENANCE_MODE === '1' && matchesPrefix(path, MAINT_PREFIXES);
  const needsAuth = matchesPrefix(path, AUTH_PREFIXES);

  // 토큰은 필요할 때만 1회 조회.
  const token = inMaint || needsAuth ? await getToken({ req, secret: process.env.NEXTAUTH_SECRET }) : null;
  const email = String(token?.email || '').toLowerCase();
  const isAdmin = ADMIN_EMAILS.includes(email);

  // 1) 점검 게이트: 제작 도구 진입 시 홈 팝업(?maintenance=1)으로. 단 관리자는 테스트 목적으로 통과.
  if (inMaint && !isAdmin) {
    return NextResponse.redirect(new URL('/?maintenance=1', req.url));
  }

  // 2) 로그인/관리자 게이트 (기존 동작). 점검이 꺼졌을 때만 실질 동작.
  if (needsAuth) {
    if (!token) {
      const loginUrl = new URL('/login', req.url);
      loginUrl.searchParams.set('callbackUrl', path + req.nextUrl.search);
      return NextResponse.redirect(loginUrl);
    }
    if (!isAdmin && ADMIN_ONLY.some((p) => path === p || path.startsWith(p + '/'))) {
      return NextResponse.redirect(new URL('/studio', req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/studio/:path*',
    '/promo/:path*',
    '/promo-character/:path*',
    '/character/:path*',
    '/history/:path*',
    '/admin/:path*',
  ],
};
