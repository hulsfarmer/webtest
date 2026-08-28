import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import { hasCredits, chargeCredits } from '@/lib/usageStore';
import { generateOneSet, renderBanner, renderProfile, type BrandInput } from '@/lib/banner-designer';

export const runtime = 'nodejs';
export const maxDuration = 120; // Claude 1콜 + 렌더

const SET_CREDITS = 1; // 1세트 생성 요금(스타일 선택형)

/** 브랜드 정보 → 유튜브 배너+프로필 3세트 생성·렌더 → 미리보기 data URL 반환 (2크레딧) */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id ?? (process.env.NODE_ENV !== 'production' ? 'dev-local' : null);
  if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const admin = isAdminEmail(session?.user?.email); // 관리자는 테스트 무료(과금 면제)

  let body: BrandInput & { style?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 }); }
  if (!body.brandName?.trim()) return NextResponse.json({ error: '브랜드/채널 이름을 입력하세요.' }, { status: 400 });

  // 크레딧 사전 확인(부족하면 생성 전 차단 → 비용 안 나감). 관리자는 면제.
  if (!admin && !(await hasCredits(userId, SET_CREDITS))) {
    return NextResponse.json({ error: `크레딧이 부족해요 (${SET_CREDITS}크레딧 필요). 충전 후 이용해주세요.`, needCredits: SET_CREDITS }, { status: 402 });
  }

  try {
    const d = await generateOneSet(body, (body.style || 'left').trim());
    if (!d) return NextResponse.json({ error: '디자인 생성에 실패했어요. 잠시 후 다시 시도해주세요.' }, { status: 502 });

    const [banner, profile] = await Promise.all([renderBanner(d.bannerSvg), renderProfile(d.profileSvg)]);
    const set = {
      style: d.style,
      banner: `data:image/png;base64,${banner.toString('base64')}`,
      profile: `data:image/png;base64,${profile.toString('base64')}`,
      bannerSvg: d.bannerSvg, profileSvg: d.profileSvg, // 수정(refine)용
    };
    // 생성 성공 시에만 차감 (실패 시 과금 없음). 관리자는 면제.
    if (!admin) { try { await chargeCredits(userId, SET_CREDITS); } catch (e) { console.error('[youtube/banner-set] 크레딧 차감 실패:', e); } }
    return NextResponse.json({ set });
  } catch (e) {
    console.error('[youtube/banner-set]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: '생성 중 오류가 발생했어요.' }, { status: 500 });
  }
}
