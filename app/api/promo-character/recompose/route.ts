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
import { chunkForSubtitles } from '@/lib/promo-subtitles';

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

interface SttWord { w: string; s: number; e: number }

/**
 * ffmpeg 로 raw PCM 추출 → Google Cloud Speech-to-Text(v1 sync, 단어 타임오프셋)
 * 실제 음성의 단어별 타임스탬프 [{w,s,e}] 반환. 실패하면 throw.
 * STT 전용 키(GOOGLE_STT_API_KEY) 우선, 없으면 TTS 키.
 */
async function sttWords(charPath: string, tmpDir: string, tag: string): Promise<SttWord[]> {
  const apiKey = process.env.GOOGLE_STT_API_KEY || process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) throw new Error('STT API key not set');
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
        enableWordTimeOffsets: true, enableAutomaticPunctuation: false,
      },
      audio: { content },
    }),
  });
  if (!res.ok) throw new Error(`GoogleSTT ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json() as {
    results?: { alternatives?: { words?: { word: string; startTime?: unknown; endTime?: unknown }[] }[] }[];
  };
  const words: SttWord[] = [];
  for (const r of data.results || []) {
    for (const w of r.alternatives?.[0]?.words || []) {
      words.push({ w: w.word, s: parseGoogleTime(w.startTime), e: parseGoogleTime(w.endTime) });
    }
  }
  if (!words.length) throw new Error('GoogleSTT: no words');
  return words;
}

/** STT 단어들을 ≤maxChars 줄로 묶어 세그먼트로 (narration 없을 때 폴백) */
async function transcribeGoogle(charPath: string, tmpDir: string, tag: string, maxChars = 32): Promise<Seg[]> {
  const words = await sttWords(charPath, tmpDir, tag);
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

/**
 * Kling 오디오의 실제 "발화 구간"(무음 사이 말하는 구간)들을 반환 — silencedetect.
 * 홍보영상은 오디오=자막소스라 완벽 싱크. 우리는 Kling 오디오의 실제 쉼 위치를 찾아
 * 그 쉼 구조에 자막을 정렬한다(말할 때만 진행, 쉴 때 멈춤 → 강제정렬 근사).
 */
async function detectSpeechSegments(charPath: string, D: number): Promise<{ s: number; e: number }[]> {
  const ffmpeg = require('ffmpeg-static') as string;
  let out = '';
  try {
    const r = await execAsync(`"${ffmpeg}" -i "${charPath}" -af silencedetect=noise=-35dB:d=0.18 -f null - 2>&1`);
    out = `${r.stdout || ''}${r.stderr || ''}`;
  } catch (e) {
    const ee = e as { stdout?: string; stderr?: string };
    out = `${ee?.stdout || ''}${ee?.stderr || ''}`;
  }
  const starts: number[] = [];
  const ends: number[] = [];
  for (const m of out.matchAll(/silence_start:\s*([\d.]+)/g)) starts.push(parseFloat(m[1]));
  for (const m of out.matchAll(/silence_end:\s*([\d.]+)/g)) ends.push(parseFloat(m[1]));
  // 무음 구간 목록 (뒤 무음이 안 닫히면 D 로 마감)
  const silences = starts.map((s, i) => ({ s, e: ends[i] ?? D }));
  // 발화 = 무음의 여집합 [0,D]
  const speech: { s: number; e: number }[] = [];
  let cursor = 0;
  for (const sil of silences) {
    if (sil.s > cursor + 0.05) speech.push({ s: cursor, e: sil.s });
    cursor = Math.max(cursor, sil.e);
  }
  if (cursor < D - 0.05) speech.push({ s: cursor, e: D });
  return speech;
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
  const speed = Math.min(2.0, Math.max(0.5, Number(body.speed) || 1.0)); // 1.0=원속도, atempo 단일단계 범위

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
    // 1) 제품 이미지: 캐시 우선(ScraperAPI 불안정 회피). 캐시 없으면 스크래핑 후 저장.
    //    productImageUrl 로 직접 지정하면 페이지 스크래핑 생략.
    const productCachePath = path.join(process.cwd(), 'data', 'char_cache', `${charFile}.product.png`);
    let businessName = businessNameIn || '제품';
    if (fs.existsSync(productCachePath)) {
      fs.copyFileSync(productCachePath, productPath);
    } else {
      let imgUrl = (typeof body.productImageUrl === 'string' && body.productImageUrl.trim()) ? body.productImageUrl.trim() : '';
      if (!imgUrl) {
        const useProxy = !!process.env.SCRAPER_API_KEY;
        const pres = await fetchWithTimeout(proxied(productUrl), useProxy ? {} : { headers: BROWSER_HEADERS }, useProxy ? 70000 : 15000);
        if (!pres.ok) return NextResponse.json({ error: `product fetch ${pres.status}` }, { status: 422 });
        const meta = extractOgMeta(await pres.text(), productUrl);
        if (!businessNameIn && meta.title) businessName = meta.title;
        imgUrl = meta.image || '';
      }
      if (!imgUrl) return NextResponse.json({ error: 'no product image' }, { status: 422 });
      const dl = await downloadImage(imgUrl);
      if (!dl) return NextResponse.json({ error: 'product image download failed' }, { status: 422 });
      fs.writeFileSync(productPath, dl.buf);
      try { fs.copyFileSync(productPath, productCachePath); } catch { /* noop */ }  // 다음부턴 재스크래핑 불필요
    }

    // 1.5) 속도 조절(옵션): 캐릭터 영상(음성 포함)을 speed 배로. 이후 모든 계산은
    //      가속된 영상 기준이라 자막·발화구간·합성이 일관되게 빨라진다.
    let effectiveCharPath = charPath;
    if (Math.abs(speed - 1.0) > 0.01) {
      const ffmpeg = require('ffmpeg-static') as string;
      const spedPath = path.join(tmpDir, `${outId}_char_${speed}x.mp4`);
      await execAsync(`"${ffmpeg}" -y -loglevel error -i "${charPath}" -filter:v "setpts=PTS/${speed}" -filter:a "atempo=${speed}" -c:v libx264 -preset ultrafast -threads 1 -pix_fmt yuv420p -c:a aac -ar 44100 "${spedPath}"`);
      effectiveCharPath = spedPath;
      subPaths.push(spedPath); // 마지막에 정리
    }

    // 2) 자막 세그먼트: Kling 오디오의 실제 발화 구간(쉼 위치)에 정렬 (강제정렬 근사)
    const D0 = await probeDuration(effectiveCharPath);
    const narrationIn = typeof body.narration === 'string' ? body.narration.trim() : '';
    let segments: Seg[] = [];
    let subMode = 'none';
    if (narrationIn) {
      const chunks = chunkForSubtitles(narrationIn);
      // 1순위: STT 단어 타임스탬프에 나레이션을 정렬 (실제 발화 시각 = 정확 싱크)
      let sw: SttWord[] = [];
      try { sw = await sttWords(effectiveCharPath, tmpDir, outId); }
      catch (e) { console.error(`[recompose ${outId}] STT 실패, 쉼정렬로 폴백:`, e instanceof Error ? e.message : e); }

      if (sw.length >= 3 && chunks.length) {
        // 원고 전체 텍스트 유지 + STT 단어 시각을 앵커로 "정밀 정렬"
        //  1) 원고 단어 ↔ STT 단어를 순방향 매칭(앵커) → 실제 발화시각 확보
        //  2) 앵커 사이 원고 단어는 시각 보간 → STT가 놓친 단어도 자연스러운 시각
        const nWords = narrationIn.split(/\s+/).filter(Boolean);
        const NW = nWords.length, SW = sw.length;
        const norm = (s: string) => s.replace(/[^가-힣a-zA-Z0-9]/g, '');
        const wordMatch = (a: string, b: string): boolean => {
          const x = norm(a), y = norm(b);
          if (!x || !y) return false;
          return x === y || x.startsWith(y) || y.startsWith(x) || (x.length >= 2 && y.length >= 2 && x.slice(0, 2) === y.slice(0, 2));
        };
        // 앵커: (원고 index → STT 시각)
        const anchors: { ni: number; t: number }[] = [];
        let ni = 0;
        for (let k = 0; k < SW; k++) {
          for (let j = ni; j < Math.min(ni + 7, NW); j++) {
            if (wordMatch(nWords[j], sw[k].w)) { anchors.push({ ni: j, t: sw[k].s }); ni = j + 1; break; }
          }
        }
        // 원고 각 단어의 시각(초)을 앵커로 보간/외삽
        const wordTime = new Array<number>(NW);
        if (anchors.length >= 2) {
          for (let a = 0; a < anchors.length; a++) {
            const cur = anchors[a];
            wordTime[cur.ni] = cur.t;
            const next = anchors[a + 1];
            if (next) {
              const span = next.ni - cur.ni;
              for (let m = 1; m < span; m++) wordTime[cur.ni + m] = cur.t + (next.t - cur.t) * (m / span);
            }
          }
          // 앞/뒤 외삽
          const first = anchors[0], last = anchors[anchors.length - 1];
          for (let j = 0; j < first.ni; j++) wordTime[j] = Math.max(0, first.t - (first.ni - j) * 0.28);
          const tailRate = 0.28;
          for (let j = last.ni + 1; j < NW; j++) wordTime[j] = Math.min(D0, last.t + (j - last.ni) * tailRate);
        } else {
          // 앵커 부족 → 비례
          for (let j = 0; j < NW; j++) wordTime[j] = (j / Math.max(1, NW - 1)) * D0;
        }
        const LEAD = 0.15;
        let wIdx = 0;
        const raw = chunks.map((chunk) => {
          const cwCount = chunk.split(/\s+/).filter(Boolean).length || 1;
          const startWord = Math.min(NW - 1, wIdx);
          wIdx += cwCount;
          return { sStart: wordTime[startWord] ?? 0, text: chunk };
        });
        segments = raw.map((x, i) => {
          const start = Math.max(0, x.sStart - LEAD);
          const nextStart = i + 1 < raw.length ? Math.max(0, raw[i + 1].sStart - LEAD) : D0;
          const end = Math.min(Math.max(start, nextStart), D0); // 다음 시작 넘지 않음(겹침 방지)
          return { start, end, text: x.text };
        });
        console.log(`[recompose ${outId}] STT단어 ${SW} / 원고단어 ${NW} / 앵커 ${anchors.length} → 자막 ${segments.length}개 (stt-align), speed ${speed}`);
        subMode = 'stt-align';
      } else {
        // 2순위 폴백: 실제 쉼구간(silence)에 단어를 시간비례 배정
        const speech = await detectSpeechSegments(effectiveCharPath, D0);
        const totalActive = speech.reduce((a, g) => a + (g.e - g.s), 0);
        const words = narrationIn.split(/\s+/).filter(Boolean);
        if (speech.length >= 2 && totalActive > 1 && words.length) {
          const CAPTION_LEAD = 0.3;
          const totalChars = words.reduce((a: number, w: string) => a + w.length, 0) || 1;
          let cum = 0;
          const wordActiveCenter = words.map((w: string) => {
            const center = cum + w.length / 2; cum += w.length;
            return (center / totalChars) * totalActive;
          });
          const activeToSegIdx = (aT: number): number => {
            let acc = 0;
            for (let i = 0; i < speech.length; i++) {
              const len = speech[i].e - speech[i].s;
              if (aT <= acc + len) return i;
              acc += len;
            }
            return speech.length - 1;
          };
          const buckets: string[][] = speech.map(() => []);
          words.forEach((w: string, idx: number) => buckets[activeToSegIdx(wordActiveCenter[idx])].push(w));
          const raw = speech.map((g, i) => ({ g, text: buckets[i].join(' ') })).filter((x) => x.text.length > 0);
          segments = raw.map((x, i) => {
            const start = Math.max(0, x.g.s - CAPTION_LEAD);
            const nextStart = i + 1 < raw.length ? Math.max(0, raw[i + 1].g.s - CAPTION_LEAD) : D0;
            const end = Math.min(Math.max(start, nextStart), D0); // 다음 시작 넘지 않음(겹침 방지)
            return { start, end, text: x.text };
          });
          console.log(`[recompose ${outId}] 폴백 segment-align: 발화구간 ${speech.length}개→자막 ${segments.length}개, speed ${speed}`);
          subMode = 'segment-align';
        } else {
          const totalC = chunks.reduce((a, c) => a + c.length, 0) || 1;
          let acc = 0;
          segments = chunks.map((p) => {
            const dur = D0 * (p.length / totalC);
            const s = acc; acc += dur;
            return { start: s, end: acc, text: p };
          });
          subMode = 'narration';
        }
      }
    } else {
      try { segments = await transcribeGoogle(effectiveCharPath, tmpDir, outId); subMode = 'stt'; }
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
      productImagePath: productPath, characterVideoPath: effectiveCharPath,
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
