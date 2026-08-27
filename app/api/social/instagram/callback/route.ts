import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode } from '@/lib/instagram';

/** Facebook 리디렉트 콜백 → code 교환 → 페이지 토큰·IG 계정 저장 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  // 인스타는 코드 끝에 '#_'를 붙여 반환하기도 함 → '#' 이후 제거
  const code = url.searchParams.get('code')?.split('#')[0];
  const state = url.searchParams.get('state');
  const cookieState = req.cookies.get('ig_oauth_state')?.value;
  const back = (ok: string) => NextResponse.redirect(`https://shortsai.kr/promo-character?ig=${ok}`);
  if (!code || !state || !cookieState || state !== cookieState) return back('error');
  try {
    await exchangeCode(code);
  } catch (e) {
    console.error('[instagram callback] 실패:', e instanceof Error ? e.message : e);
    return back('error');
  }
  return back('connected');
}

export const dynamic = 'force-dynamic';
