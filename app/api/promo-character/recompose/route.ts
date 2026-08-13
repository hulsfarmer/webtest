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
import { generateAudioWithTimepoints } from '@/lib/tts';

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

interface Seg { start: number; end: number; text: string }

/** "1.200s" | "1s" | {seconds,nanos} → 초(float) */
function parseGoogleTime(v: unknown): number {
  if (typeof v === 'string') return parseFloat(v.replace(/s$/, '')) || 0;
  if (v && typeof v === 'object') {
    const o = v as { seconds?: string | number; nanos?: number };
    return (Number(o.seconds || 0)) + (Number(o.nanos || 0) / 1e9);
  }
  return 0;
}

/**
 * ffmpeg 로 raw PCM 추출 → Google Cloud Speech-to-Text(v1 sync, 단어 타임오프셋)
 * 단어들을 ≤maxChars 줄로 묶어 세그먼트로 반환. 실패하면 throw.
 */
async function transcribeGoogle(charPath: string, tmpDir: string, tag: string, maxChars = 32): Promise<Seg[]> {
  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_TTS_API_KEY not set');
  const ffmpeg = require('ffmpeg-static') as string;
  const pcm = path.join(tmpDir, `${tag}_stt.raw`);
  // LINEAR16 raw (헤더 없이) 16k mono
  await execAsync(`"${ffmpeg}" -y -loglevel error -i "${charPath}" -vn -ac 1 -ar 16000 -f s16le -acodec pcm_s16le "${pcm}"`);
  const content = fs.readFileSync(pcm).toString('base64');
  try { fs.unlinkSync(pcm); } catch { /* noop */ }
  const res = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: {
        encoding: 'LINEAR16', sampleRateHertz: 16000, languageCode: 'ko-KR',
        enableWordTimeOffsets: true, enableAutomaticPunctuation: true,
      },
      audio: { content },
    }),
  });
  if (!res.ok) throw new Error(`GoogleSTT ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json() as {
    results?: { alternatives?: { words?: { word: string; startTime?: unknown; endTime?: unknown }[] }[] }[];
  };
  const words: { w: string; s: number; e: number }[] = [];
  for (const r of data.results || []) {
    for (const w of r.alternatives?.[0]?.words || []) {
      words.push({ w: w.word, s: parseGoogleTime(w.startTime), e: parseGoogleTime(w.endTime) });
    }
  }
  if (!words.length) throw new Error('GoogleSTT: no words');
  // 단어 → ≤maxChars 줄 묶기
  const segs: Seg[] = [];
  let cur = ''; let cs = 0; let ce = 0;
  for (const wd of words) {
    const cand = cur ? `${cur} ${wd.w}` : wd.w;
    if (cand.length > maxChars && cur) {
      segs.push({ start: cs, end: ce, text: cur });
      cur = wd.w; cs = wd.s; ce = wd.e;
    } else {
      if (!cur) cs = wd.s;
      cur = cand; ce = wd.e;
    }
  }
  if (cur) segs.push({ start: cs, end: ce, text: cur });
  return segs;
}

/** Kling 오디오의 실제 발화 구간 [start,end] (앞뒤 무음 제거) — silencedetect */
async function detectSpeechWindow(charPath: string, D: number): Promise<{ start: number; end: number }> {
  const ffmpeg = require('ffmpeg-static') as string;
  let out = '';
  try {
    const r = await execAsync(`"${ffmpeg}" -i "${charPath}" -af silencedetect=noise=-35dB:d=0.25 -f null - 2>&1`);
    out = `${r.stdout || ''}${r.stderr || ''}`;
  } catch (e) {
    const ee = e as { stdout?: string; stderr?: string };
    out = `${ee?.stdout || ''}${ee?.stderr || ''}`;
  }
  const starts: number[] = [];
  const ends: number[] = [];
  for (const m of out.matchAll(/silence_start:\s*([\d.]+)/g)) starts.push(parseFloat(m[1]));
  for (const m of out.matchAll(/silence_end:\s*([\d.]+)/g)) ends.push(parseFloat(m[1]));
  let start = 0, end = D;
  if (starts.length && starts[0] < 0.6 && ends.length) start = ends[0];   // 앞 무음 끝 = 발화 시작
  if (starts.length > ends.length) end = starts[starts.length - 1];        // 뒤 무음 시작 = 발화 끝
  if (!(end > start + 1)) { start = 0; end = D; }                          // 안전장치
  return { start, end };
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

    // 2) 자막 세그먼트 확보:
    //    (a) body.narration 있으면 → 전체 길이에 글자수 비례 배분
    //    (b) 없으면 Google STT(단어 타임오프셋). 실패하면 자막 없이 진행
    const D0 = await probeDuration(charPath);
    const narrationIn = typeof body.narration === 'string' ? body.narration.trim() : '';
    let segments: Seg[] = [];
    let subMode = 'none';
    if (narrationIn) {
      // 홍보영상과 동일한 정확 싱크: 문장별 실제 발화길이를 TTS로 측정
      // (Chirp3-HD는 문장별 생성해 실측). 측정 오디오는 버리고 Kling 오디오 유지.
      const voice = (typeof body.voice === 'string' && body.voice.trim()) ? body.voice.trim() : 'ko-KR-Chirp3-HD-Aoede';
      const sentences = narrationIn.split(/(?<=[.!?。！？])\s*/).map((x: string) => x.trim()).filter(Boolean);
      const measurePath = path.join(tmpDir, `${outId}_measure.mp3`);
      let durations: number[] = [];
      try { durations = await generateAudioWithTimepoints(sentences, measurePath, voice, 1.0); }
      catch (e) { console.error(`[recompose ${outId}] 발화측정 실패:`, e instanceof Error ? e.message : e); }
      try { fs.unlinkSync(measurePath); } catch { /* noop */ }

      const buildFromDurations = durations.length === sentences.length && durations.some((d) => d > 0);
      if (buildFromDurations) {
        // 측정한 문장별 상대비율을 실제 발화구간[win.start,win.end]에 맞춰 스케일
        // (Kling 앞뒤 무음 보정 → 자막이 음성과 정렬). 문장 내 청크는 글자수 비례.
        const win = await detectSpeechWindow(charPath, D0);
        const totalMeasured = durations.reduce((a, b) => a + b, 0) || 1;
        const scale = (win.end - win.start) / totalMeasured;
        let acc = win.start;
        segments = [];
        for (let i = 0; i < sentences.length; i++) {
          const parts = chunkForSubtitles(sentences[i]);
          const dur = durations[i] * scale;
          if (!parts.length) { acc += dur; continue; }
          const totalC = parts.reduce((a, c) => a + c.length, 0) || 1;
          let inner = acc;
          for (const p of parts) {
            const d = dur * (p.length / totalC);
            segments.push({ start: inner, end: Math.min(inner + d, D0), text: p });
            inner += d;
          }
          acc += dur;
        }
        console.log(`[recompose ${outId}] 발화구간 ${win.start.toFixed(2)}~${win.end.toFixed(2)}s, 측정합 ${totalMeasured.toFixed(2)}s, scale ${scale.toFixed(3)}`);
        subMode = 'measured';
      } else {
        // 폴백: 전체 길이에 글자수 비례
        const parts = chunkForSubtitles(narrationIn);
        const totalC = parts.reduce((a, c) => a + c.length, 0) || 1;
        let acc = 0;
        segments = parts.map((p) => {
          const dur = D0 * (p.length / totalC);
          const s = acc; acc += dur;
          return { start: s, end: acc, text: p };
        });
        subMode = 'narration';
      }
    } else {
      try { segments = await transcribeGoogle(charPath, tmpDir, outId); subMode = 'stt'; }
      catch (e) { console.error(`[recompose ${outId}] STT 실패, 자막 없이 진행:`, e instanceof Error ? e.message : e); }
    }

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
    const D = D0;
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
      duration: +D.toFixed(2), subtitles: subtitles.length, subMode, businessName,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
