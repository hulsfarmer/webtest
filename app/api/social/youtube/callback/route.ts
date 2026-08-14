import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode } from '@/lib/youtube';

/** Google 리디렉트 콜백 → code 교환 → refresh_token 저장 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = req.cookies.get('yt_oauth_state')?.value;
  const back = (ok: string) => NextResponse.redirect(`https://shortsai.kr/promo-character?yt=${ok}`);
  if (!code || !state || !cookieState || state !== cookieState) return back('error');
  try {
    await exchangeCode(code);
  } catch (e) {
    console.error('[youtube callback] 실패:', e instanceof Error ? e.message : e);
    return back('error');
  }
  return back('connected');
}

export const dynamic = 'force-dynamic';
