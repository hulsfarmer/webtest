import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { extractOgMeta, isSeoJunkDescription, extractDetailImages } from '@/lib/product-import';
import { extractSellingPointsFromImages } from '@/lib/product-vision';
import { isAdminEmail } from '@/lib/admin';
import { isNaverStoreUrl, fetchNaverProduct } from '@/lib/naver-commerce';

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

  // 자동 불러오기는 관리자 전용 (개발환경은 예외)
  const isAdmin = isAdminEmail(session?.user?.email) || process.env.NODE_ENV !== 'production';
  if (!isAdmin) return NextResponse.json({ error: '관리자 전용 기능입니다.' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const url = String(body.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return NextResponse.json({ error: '올바른 상품 URL을 입력해주세요.' }, { status: 400 });

  // 추출 결과가 모이는 공통 변수 (네이버 API / 스크래핑 두 경로 모두 여기로 수렴)
  let meta: { title?: string; category?: string; description?: string; image?: string };
  let detailImageUrls: string[] = [];

  if (isNaverStoreUrl(url)) {
    // ── 네이버 스마트스토어: 커머스 API 로 상품번호 조회 ──
    try {
      const p = await fetchNaverProduct(url);
      meta = { title: p.title, category: p.category, description: p.description, image: p.image };
      detailImageUrls = p.detailImages;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[import] 네이버 커머스 API 실패 — ${url}: ${msg}`);
      return NextResponse.json({ error: msg }, { status: 422 });
    }
  } else {
    // ── 그 외(쿠팡 등): 페이지 fetch → og 메타 스크래핑 ──
    // ScraperAPI 키 있으면 프록시 경유 → 쿠팡 우회. 간헐 5xx/네트워크오류면 최대 3회 재시도(백오프).
    const useProxy = !!process.env.SCRAPER_API_KEY;
    let html = '';
    let lastStatus = 0; // 0=미시도, -1=네트워크/타임아웃, 그외=HTTP status
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetchWithTimeout(proxied(url), useProxy ? {} : { headers: BROWSER_HEADERS }, useProxy ? 70000 : 15000);
        if (res.ok) { html = await res.text(); break; }
        lastStatus = res.status;
        console.warn(`[import] 시도 ${attempt}/${maxAttempts} HTTP ${res.status} — ${url}`);
        if (res.status < 500) break; // 4xx 는 재시도 무의미
      } catch {
        lastStatus = -1;
        console.warn(`[import] 시도 ${attempt}/${maxAttempts} 네트워크/타임아웃 — ${url}`);
      }
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 1500 * attempt)); // 1.5s, 3s 백오프
    }
    if (!html) {
      if (lastStatus === -1) return NextResponse.json({ error: '페이지를 불러오지 못했어요 (차단·시간초과). 직접 입력해주세요.' }, { status: 422 });
      return NextResponse.json({
        error: `자동 불러오기에 실패했어요 (HTTP ${lastStatus}). 잠시 후 다시 시도하거나 직접 입력해주세요.`,
      }, { status: 422 });
    }

    meta = extractOgMeta(html, url);
    if (!meta.title && !meta.image) {
      return NextResponse.json({ error: '이 페이지에서 제품 정보를 못 찾았어요. 직접 입력해주세요.' }, { status: 422 });
    }
    detailImageUrls = extractDetailImages(html, url, 3);
  }

  // 3) 대표 이미지 다운로드 → 저장(영상용) + data URI(미리보기용)
  let imageUrl = '';   // 미리보기 data URI (런타임 정적서빙 의존 제거)
  let imagePath = '';  // 영상 생성용 경로 (/imports/xxx)
  if (meta.image) {
    const dl = await downloadImage(meta.image);
    if (dl) {
      const dir = path.join(process.cwd(), 'public', 'imports');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const name = `${uuidv4()}.${dl.ext}`;
      fs.writeFileSync(path.join(dir, name), dl.buf);
      imagePath = `/imports/${name}`;
      const mime = dl.ext === 'png' ? 'image/png' : dl.ext === 'webp' ? 'image/webp' : dl.ext === 'gif' ? 'image/gif' : 'image/jpeg';
      imageUrl = `data:${mime};base64,${dl.buf.toString('base64')}`;
    }
  }

  // 홍보 포인트: 설명이 없거나 SEO 문구면 → 상세페이지 이미지를 Claude 가 읽어 추출
  // (실패해도 제품명·이미지는 반드시 반환되도록 try/catch)
  let description = isSeoJunkDescription(meta.description) ? '' : (meta.description || '');
  let descriptionSource: 'meta' | 'images' | '' = description ? 'meta' : '';
  if (!description) {
    try {
      console.log(`[import] 상세이미지 ${detailImageUrls.length}개 추출`);
      if (detailImageUrls.length) {
        const pts = await extractSellingPointsFromImages(detailImageUrls, meta.title || '');
        if (pts) { description = pts; descriptionSource = 'images'; }
      }
    } catch (e) {
      console.error('[import] 상세이미지 홍보포인트 추출 실패:', e instanceof Error ? e.message : e);
    }
  }

  console.log(`[import] ${url} → title:${!!meta.title} 업종:${!!meta.category} 이미지:${!!imagePath} 홍보포인트:${descriptionSource || 'none'}`);
  return NextResponse.json({
    title: meta.title || '',
    businessType: meta.category || '',
    description,
    descriptionSource, // '' | 'meta' | 'images'
    imageUrl,          // 미리보기 data URI
    imagePath,         // 영상 생성용 /imports/xxx
  });
}
