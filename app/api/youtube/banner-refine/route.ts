import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import { hasCredits, chargeCredits } from '@/lib/usageStore';
import { refineDesignSet, renderBanner, renderProfile } from '@/lib/banner-designer';

export const runtime = 'nodejs';
export const maxDuration = 120;

const REFINE_CREDITS = 1; // 수정 1회 요금

/** 기존 세트(SVG) + 수정 지시 → 수정된 세트 렌더 반환 (1크레딧) */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id ?? (process.env.NODE_ENV !== 'production' ? 'dev-local' : null);
  if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const admin = isAdminEmail(session?.user?.email);

  let body: { bannerSvg?: string; profileSvg?: string; instruction?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 }); }
  const { bannerSvg, profileSvg, instruction } = body;
  if (!bannerSvg || !profileSvg) return NextResponse.json({ error: '수정할 디자인이 없습니다.' }, { status: 400 });
  if (!instruction?.trim()) return NextResponse.json({ error: '수정할 내용을 입력하세요.' }, { status: 400 });

  if (!admin && !(await hasCredits(userId, REFINE_CREDITS))) {
    return NextResponse.json({ error: `크레딧이 부족해요 (${REFINE_CREDITS}크레딧 필요).`, needCredits: REFINE_CREDITS }, { status: 402 });
  }

  try {
    const d = await refineDesignSet(bannerSvg, profileSvg, instruction.trim());
    if (!d) return NextResponse.json({ error: '수정에 실패했어요. 요청을 조금 바꿔 다시 시도해주세요.' }, { status: 502 });
    const [banner, profile] = await Promise.all([renderBanner(d.bannerSvg), renderProfile(d.profileSvg)]);
    if (!admin) { try { await chargeCredits(userId, REFINE_CREDITS); } catch (e) { console.error('[banner-refine] 차감 실패:', e); } }
    return NextResponse.json({
      set: {
        style: d.style,
        banner: `data:image/png;base64,${banner.toString('base64')}`,
        profile: `data:image/png;base64,${profile.toString('base64')}`,
        bannerSvg: d.bannerSvg, profileSvg: d.profileSvg,
      },
    });
  } catch (e) {
    console.error('[banner-refine]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: '수정 중 오류가 발생했어요.' }, { status: 500 });
  }
}
