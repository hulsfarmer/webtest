import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { extractOgMeta } from '@/lib/product-import';

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

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ?? (process.env.NODE_ENV !== 'production' ? 'dev-local' : null);
  if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const url = String(body.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return NextResponse.json({ error: '올바른 상품 URL을 입력해주세요.' }, { status: 400 });

  // 1) 페이지 fetch
  let html = '';
  try {
    const res = await fetchWithTimeout(url, { headers: BROWSER_HEADERS }, 15000);
    if (!res.ok) {
      return NextResponse.json({
        error: `이 사이트는 자동 불러오기가 막혀 있어요 (HTTP ${res.status}). 쿠팡 등 일부 사이트는 봇을 차단합니다. 직접 입력해주세요.`,
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
    try {
      const imgRes = await fetchWithTimeout(meta.image, { headers: BROWSER_HEADERS }, 15000);
      const ct = imgRes.headers.get('content-type') || '';
      if (imgRes.ok && ct.startsWith('image/')) {
        const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('gif') ? 'gif' : 'jpg';
        const buf = Buffer.from(await imgRes.arrayBuffer());
        if (buf.length <= 15 * 1024 * 1024) {
          const dir = path.join(process.cwd(), 'public', 'imports');
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const name = `${uuidv4()}.${ext}`;
          fs.writeFileSync(path.join(dir, name), buf);
          imageUrl = `/imports/${name}`;
        }
      }
    } catch { /* 이미지 실패해도 텍스트는 반환 */ }
  }

  return NextResponse.json({
    title: meta.title || '',
    description: meta.description || '',
    imageUrl: imageUrl || '',
  });
}
