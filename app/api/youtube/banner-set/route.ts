import { NextRequest, NextResponse } from 'next/server';
import { adminGuard } from '@/lib/admin-guard';
import { generateDesignSets, renderBanner, renderProfile, type BrandInput } from '@/lib/banner-designer';

export const runtime = 'nodejs';
export const maxDuration = 180; // Claude 3콜 + 렌더

/** 브랜드 정보 → 유튜브 배너+프로필 3세트 생성·렌더 → 미리보기 data URL 반환 */
export async function POST(req: NextRequest) {
  const denied = await adminGuard();
  if (denied) return denied;

  let body: BrandInput;
  try { body = await req.json(); } catch { return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 }); }
  if (!body.brandName?.trim()) return NextResponse.json({ error: '브랜드/채널 이름을 입력하세요.' }, { status: 400 });

  try {
    const designs = await generateDesignSets(body);
    if (!designs.length) return NextResponse.json({ error: '디자인 생성에 실패했어요. 잠시 후 다시 시도해주세요.' }, { status: 502 });

    const sets = await Promise.all(designs.map(async (d) => {
      const [banner, profile] = await Promise.all([renderBanner(d.bannerSvg), renderProfile(d.profileSvg)]);
      return {
        style: d.style,
        banner: `data:image/png;base64,${banner.toString('base64')}`,
        profile: `data:image/png;base64,${profile.toString('base64')}`,
      };
    }));
    return NextResponse.json({ sets });
  } catch (e) {
    console.error('[youtube/banner-set]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: '생성 중 오류가 발생했어요.' }, { status: 500 });
  }
}
