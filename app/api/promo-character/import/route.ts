import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { extractOgMeta, isSeoJunkDescription, extractDetailImages } from '@/lib/product-import';
import { extractSellingPointsFromImages } from '@/lib/product-vision';

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
};

async function fetchWithTimeout(url: string, opts: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'follow' });
  } finally { clearTimeout(t); }
}

/** ScraperAPI 프록시 URL (봇차단 우회). 키 없으면 원본 그대로 */
function proxied(target: string): string {
  const key = process.env.SCRAPER_API_KEY;
  return key
    ? `https://api.scraperapi.com/?api_key=${key}&country_code=kr&url=${encodeURIComponent(target)}`
    : target;
}

/** 대표 이미지 다운로드: 직접 → 실패 시 프록시 경유 */
async function downloadImage(imgUrl: string): Promise<{ buf: Buffer; ext: string } | null> {
  const tryFetch = async (u: string) => {
    const r = await fetchWithTimeout(u, { headers: BROWSER_HEADERS }, 20000);
    const ct = r.headers.get('content-type') || '';
    if (r.ok && ct.startsWith('image/')) {
      const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('gif') ? 'gif' : 'jpg';
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length <= 15 * 1024 * 1024) return { buf, ext };
    }
    return null;
  };
  try { const d = await tryFetch(imgUrl); if (d) return d; } catch { /* fall through */ }
  if (process.env.SCRAPER_API_KEY) {
    try { const d = await tryFetch(proxied(imgUrl)); if (d) return d; } catch { /* noop */ }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ?? (process.env.NODE_ENV !== 'production' ? 'dev-local' : null);
  if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const url = String(body.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return NextResponse.json({ error: '올바른 상품 URL을 입력해주세요.' }, { status: 400 });

  // 1) 페이지 fetch (ScraperAPI 키 있으면 프록시 경유 → 쿠팡·네이버 우회)
  const useProxy = !!process.env.SCRAPER_API_KEY;
  let html = '';
  try {
    const res = await fetchWithTimeout(proxied(url), useProxy ? {} : { headers: BROWSER_HEADERS }, useProxy ? 70000 : 15000);
    if (!res.ok) {
      return NextResponse.json({
        error: `자동 불러오기에 실패했어요 (HTTP ${res.status}). 직접 입력해주세요.`,
      }, { status: 422 });
    }
    html = await res.text();
  } catch {
    return NextResponse.json({ error: '페이지를 불러오지 못했어요 (차단·시간초과). 직접 입력해주세요.' }, { status: 422 });
  }

  // 2) og 메타 추출
  const meta = extractOgMeta(html, url);
  if (!meta.title && !meta.image) {
    return NextResponse.json({ error: '이 페이지에서 제품 정보를 못 찾았어요. 직접 입력해주세요.' }, { status: 422 });
  }

  // 3) 대표 이미지 다운로드 → public/imports 저장
  let imageUrl: string | undefined;
  if (meta.image) {
    const dl = await downloadImage(meta.image);
    if (dl) {
      const dir = path.join(process.cwd(), 'public', 'imports');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const name = `${uuidv4()}.${dl.ext}`;
      fs.writeFileSync(path.join(dir, name), dl.buf);
      imageUrl = `/imports/${name}`;
    }
  }

  // 홍보 포인트: og 설명이 SEO 문구면 → 상세페이지 이미지를 Claude 가 읽어 추출
  // (실패해도 제품명·이미지는 반드시 반환되도록 try/catch)
  let description = isSeoJunkDescription(meta.description) ? '' : (meta.description || '');
  let descriptionSource: 'meta' | 'images' | '' = description ? 'meta' : '';
  if (!description) {
    try {
      const detailImgs = extractDetailImages(html, url, 3);
      if (detailImgs.length) {
        const pts = await extractSellingPointsFromImages(detailImgs, meta.title || '');
        if (pts) { description = pts; descriptionSource = 'images'; }
      }
    } catch (e) {
      console.error('[import] 상세이미지 홍보포인트 추출 실패:', e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({
    title: meta.title || '',
    businessType: meta.category || '',
    description,
    descriptionSource, // '' | 'meta' | 'images'
    imageUrl: imageUrl || '',
  });
}
