import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';
import { extractOgMeta } from '@/lib/product-import';
import {
  renderHeaderOverlay, renderCtaOverlay, renderPipAssets, renderSubtitle,
  composePromoCharacter, probeDuration,
} from '@/lib/promo-compose';

const execAsync = promisify(exec);

/**
 * 재합성 전용 내부 API (Kling 재과금 없음).
 * 이미 생성된 캐릭터 영상(data/char_cache/<charFile>)을 받아
 *  - 음성 → OpenAI Whisper STT 로 자막(정확 타임스탬프) 생성
 *  - 제품 이미지 재다운로드(ScraperAPI) + 헤더/CTA/PiP 렌더
 *  - 2-패스 합성 → public/videos/<outId>.mp4
 * 내부(localhost) 호출만 허용.
 */

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
};

function proxied(target: string): string {
  const key = process.env.SCRAPER_API_KEY;
  return key
    ? `https://api.scraperapi.com/?api_key=${key}&country_code=kr&url=${encodeURIComponent(target)}`
    : target;
}

async function fetchWithTimeout(url: string, opts: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'follow' }); }
  finally { clearTimeout(t); }
}

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
  try { const d = await tryFetch(imgUrl); if (d) return d; } catch { /* noop */ }
  if (process.env.SCRAPER_API_KEY) {
    try { const d = await tryFetch(proxied(imgUrl)); if (d) return d; } catch { /* noop */ }
  }
  return null;
}

/** 자막용 청크: 문장 → ≤32자 (긴 문장은 어절 분할) — route.ts 와 동일 */
function chunkForSubtitles(text: string, maxChars = 32): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  const sents = clean.split(/(?<=[.!?。…])\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (const s of sents) {
    if (s.length <= maxChars) { chunks.push(s); continue; }
    let cur = '';
    for (const w of s.split(' ')) {
      const t = cur ? `${cur} ${w}` : w;
      if (t.length <= maxChars || !cur) cur = t;
      else { chunks.push(cur); cur = w; }
    }
    if (cur) chunks.push(cur);
  }
  return chunks.filter(Boolean);
}

interface WhisperSeg { start: number; end: number; text: string }

/** ffmpeg 로 오디오 추출 → OpenAI Whisper(verbose_json) 로 세그먼트 타임스탬프 획득 */
async function transcribe(charPath: string, tmpDir: string, tag: string): Promise<WhisperSeg[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const ffmpeg = require('ffmpeg-static') as string;
  const wav = path.join(tmpDir, `${tag}_stt.wav`);
  await execAsync(`"${ffmpeg}" -y -loglevel error -i "${charPath}" -vn -ac 1 -ar 16000 -acodec pcm_s16le "${wav}"`);
  const buf = fs.readFileSync(wav);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'audio/wav' }), 'audio.wav');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('language', 'ko');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form,
  });
  try { fs.unlinkSync(wav); } catch { /* noop */ }
  if (!res.ok) throw new Error(`Whisper ${res.status}: ${await res.text()}`);
  const data = await res.json() as { segments?: WhisperSeg[] };
  return (data.segments || []).filter((s) => s.text && s.text.trim());
}

export async function POST(req: NextRequest) {
  // 내부(localhost) 호출만 허용 — 공개 트래픽은 nginx 경유(host=shortsai.kr)
  const host = req.headers.get('host') || '';
  if (!/^(localhost|127\.0\.0\.1)(:|$)/.test(host)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const charFile = String(body.charFile || '').replace(/[^a-zA-Z0-9_.-]/g, '');
  const productUrl = String(body.productUrl || '').trim();
  const businessNameIn = typeof body.businessName === 'string' ? body.businessName.trim() : '';
  const catchphrase = typeof body.catchphrase === 'string' ? body.catchphrase.trim() : '';
  const cta = (typeof body.cta === 'string' && body.cta.trim()) ? body.cta.trim() : '지금 구매하기';
  const theme = (typeof body.theme === 'string' && body.theme.trim()) ? body.theme.trim() : 'navy';

  const charPath = path.join(process.cwd(), 'data', 'char_cache', charFile);
  if (!charFile || !fs.existsSync(charPath)) {
    return NextResponse.json({ error: `char not found: ${charFile}` }, { status: 404 });
  }
  if (!/^https?:\/\//i.test(productUrl)) {
    return NextResponse.json({ error: 'productUrl required' }, { status: 400 });
  }

  const outId = `recompose-${uuidv4().slice(0, 8)}`;
  const tmpDir = path.join(process.cwd(), 'data', 'tmp');
  const videoDir = path.join(process.cwd(), 'public', 'videos');
  [tmpDir, videoDir].forEach((d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

  const headerPath = path.join(tmpDir, `${outId}_header.png`);
  const ctaPath = path.join(tmpDir, `${outId}_cta.png`);
  const maskPath = path.join(tmpDir, `${outId}_mask.png`);
  const ringPath = path.join(tmpDir, `${outId}_ring.png`);
  const productPath = path.join(tmpDir, `${outId}_product.png`);
  const outPath = path.join(videoDir, `${outId}.mp4`);
  const subPaths: string[] = [];

  try {
    // 1) 제품 페이지 → og 메타 (제목/이미지)
    const useProxy = !!process.env.SCRAPER_API_KEY;
    const pres = await fetchWithTimeout(proxied(productUrl), useProxy ? {} : { headers: BROWSER_HEADERS }, useProxy ? 70000 : 15000);
    if (!pres.ok) return NextResponse.json({ error: `product fetch ${pres.status}` }, { status: 422 });
    const meta = extractOgMeta(await pres.text(), productUrl);
    const businessName = businessNameIn || meta.title || '제품';
    if (!meta.image) return NextResponse.json({ error: 'no product image' }, { status: 422 });
    const dl = await downloadImage(meta.image);
    if (!dl) return NextResponse.json({ error: 'product image download failed' }, { status: 422 });
    fs.writeFileSync(productPath, dl.buf);

    // 2) STT → 자막 큐 (세그먼트 타임스탬프 기반, 청크 글자수 비례 분배)
    const segments = await transcribe(charPath, tmpDir, outId);
    const subtitles: { path: string; start: number; end: number }[] = [];
    let idx = 0;
    for (const seg of segments) {
      const parts = chunkForSubtitles(seg.text.trim());
      if (!parts.length) continue;
      const total = parts.reduce((a, c) => a + c.length, 0) || 1;
      let acc = seg.start;
      for (const p of parts) {
        const dur = (seg.end - seg.start) * (p.length / total);
        const start = acc, end = acc + dur; acc += dur;
        const sp = path.join(tmpDir, `${outId}_sub${idx}.png`);
        await renderSubtitle(p, sp);
        subtitles.push({ path: sp, start: +start.toFixed(2), end: +end.toFixed(2) });
        subPaths.push(sp);
        idx++;
      }
    }

    // 3) 헤더/CTA/PiP 렌더
    await Promise.all([
      renderHeaderOverlay(businessName, catchphrase, theme, headerPath),
      renderCtaOverlay(cta, ctaPath),
      renderPipAssets(maskPath, ringPath),
    ]);

    // 4) 2-패스 합성
    const D = await probeDuration(charPath);
    const t1 = +(D * 0.28).toFixed(2), t2 = +(D * 0.72).toFixed(2);
    await composePromoCharacter({
      productImagePath: productPath, characterVideoPath: charPath,
      headerPath, ctaPath, pipMaskPath: maskPath, ringPath,
      durationSec: +D.toFixed(2), t1, t2, outPath, subtitles,
    });

    // 정리(캐릭터 원본은 캐시에 보존)
    [headerPath, ctaPath, maskPath, ringPath, productPath, ...subPaths]
      .forEach((f) => { try { fs.unlinkSync(f); } catch { /* noop */ } });

    return NextResponse.json({
      ok: true, outId, url: `/api/video/${outId}`,
      duration: +D.toFixed(2), subtitles: subtitles.length, businessName,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
