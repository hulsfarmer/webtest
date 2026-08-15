import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode } from '@/lib/tiktok';

/** 틱톡 리디렉트 콜백 → code 교환 → refresh_token 저장 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = req.cookies.get('tt_oauth_state')?.value;
  const back = (ok: string) => NextResponse.redirect(`https://shortsai.kr/promo-character?tt=${ok}`);
  if (!code || !state || !cookieState || state !== cookieState) return back('error');
  try {
    await exchangeCode(code);
  } catch (e) {
    console.error('[tiktok callback] 실패:', e instanceof Error ? e.message : e);
    return back('error');
  }
  return back('connected');
}

export const dynamic = 'force-dynamic';
