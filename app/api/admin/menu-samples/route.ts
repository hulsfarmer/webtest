import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { adminGuard } from '@/lib/admin-guard';
import { supabase } from '@/lib/supabase';
import {
  readMenuSamples, setMenuVideo, setLogoStyle, setBannerStyle,
  VIDEO_MENU_KEYS, LOGO_STYLE_IDS, BANNER_STYLE_IDS, LOGO_DIR,
} from '@/lib/menuSamples';

export const dynamic = 'force-dynamic';

// GET: 현재 매핑 + 드롭다운용 최근 완성 영상 목록
export async function GET() {
  const guard = await adminGuard();
  if (guard) return guard;

  const samples = readMenuSamples();

  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, business_name, video_url, created_at')
    .eq('status', 'done')
    .not('video_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(40);

  const recentVideos = (jobs ?? []).map((j) => ({
    jobId: j.id,
    videoUrl: j.video_url as string,
    posterUrl: j.video_url ? `${j.video_url}/thumb` : null,
    businessName: j.business_name || '(제목 없음)',
    createdAt: j.created_at,
  }));

  return NextResponse.json({ samples, recentVideos });
}

const ALLOWED_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg',
};

// POST: 영상 지정(JSON) 또는 로고 이미지 업로드(multipart)
export async function POST(req: NextRequest) {
  const guard = await adminGuard();
  if (guard) return guard;

  const ct = req.headers.get('content-type') || '';

  // ── 로고·배너 이미지 업로드 ──
  if (ct.includes('multipart/form-data')) {
    const fd = await req.formData();
    const kind = String(fd.get('kind') || 'logo'); // 'logo' | 'banner'
    const style = String(fd.get('style') || '');
    const file = fd.get('file') as File | null;
    const isBanner = kind === 'banner';
    const validIds = isBanner ? BANNER_STYLE_IDS : LOGO_STYLE_IDS;
    if (!validIds.includes(style)) return NextResponse.json({ error: '알 수 없는 스타일' }, { status: 400 });
    if (!file || typeof file.arrayBuffer !== 'function') return NextResponse.json({ error: '이미지 파일이 필요합니다.' }, { status: 400 });
    const ext = ALLOWED_EXT[file.type];
    if (!ext) return NextResponse.json({ error: 'PNG·JPG·WEBP·SVG만 업로드할 수 있어요.' }, { status: 400 });
    if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: '8MB 이하 이미지만 가능해요.' }, { status: 400 });

    if (!fs.existsSync(LOGO_DIR)) fs.mkdirSync(LOGO_DIR, { recursive: true });
    // 배너/로고 파일명 프리픽스로 구분(스타일 id 충돌 방지 + 캐시 회피 타임스탬프)
    const prefix = isBanner ? `bnr-${style}` : style;
    try { for (const f of fs.readdirSync(LOGO_DIR)) if (f.startsWith(`${prefix}-`) || f === `${prefix}.${ext}`) fs.unlinkSync(path.join(LOGO_DIR, f)); } catch { /* 무시 */ }
    const fname = `${prefix}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(LOGO_DIR, fname), Buffer.from(await file.arrayBuffer()));
    const url = `/api/logo-sample/${fname}`;
    const s = isBanner ? setBannerStyle(style, url) : setLogoStyle(style, url);
    return NextResponse.json({ ok: true, samples: s });
  }

  // ── 영상 지정 / 로고·배너 해제 (JSON) ──
  let body: { menuKey?: string; jobId?: string; videoUrl?: string; posterUrl?: string; businessName?: string; clearLogo?: string; clearBanner?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '잘못된 요청' }, { status: 400 }); }

  if (body.clearLogo) {
    if (!LOGO_STYLE_IDS.includes(body.clearLogo)) return NextResponse.json({ error: '알 수 없는 스타일' }, { status: 400 });
    const s = setLogoStyle(body.clearLogo, null);
    return NextResponse.json({ ok: true, samples: s });
  }

  if (body.clearBanner) {
    if (!BANNER_STYLE_IDS.includes(body.clearBanner)) return NextResponse.json({ error: '알 수 없는 스타일' }, { status: 400 });
    const s = setBannerStyle(body.clearBanner, null);
    return NextResponse.json({ ok: true, samples: s });
  }

  const menuKey = String(body.menuKey || '');
  if (!VIDEO_MENU_KEYS.includes(menuKey)) return NextResponse.json({ error: '알 수 없는 메뉴' }, { status: 400 });

  if (!body.jobId) {
    const s = setMenuVideo(menuKey, null); // 해제
    return NextResponse.json({ ok: true, samples: s });
  }
  const videoUrl = String(body.videoUrl || '');
  if (!videoUrl) return NextResponse.json({ error: 'videoUrl이 필요합니다.' }, { status: 400 });
  const s = setMenuVideo(menuKey, {
    jobId: String(body.jobId),
    videoUrl,
    posterUrl: body.posterUrl || `${videoUrl}/thumb`,
    businessName: body.businessName,
  });
  return NextResponse.json({ ok: true, samples: s });
}
