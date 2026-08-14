/**
 * 나레이션 자막 정렬 + 배속 공유 로직 (메인 /promo-character 와 recompose 공용).
 * 실제 Kling 오디오에서 STT 단어 타임스탬프를 뽑아, 원고 텍스트를 실제 발화시각에
 * 앵커로 정밀 정렬한다. STT 실패 시 쉼정렬(silence) → 글자수 비례 순으로 폴백.
 */
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface SubCue { start: number; end: number; text: string }
interface SttWord { w: string; s: number; e: number }

/** 자막용 청크: 문장 → ≤maxChars (긴 문장은 어절 분할) */
export function chunkForSubtitles(text: string, maxChars = 32): string[] {
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

/** "1.200s" | {seconds,nanos} → 초 */
function parseGoogleTime(v: unknown): number {
  if (typeof v === 'string') return parseFloat(v.replace(/s$/, '')) || 0;
  if (v && typeof v === 'object') {
    const o = v as { seconds?: string | number; nanos?: number };
    return Number(o.seconds || 0) + Number(o.nanos || 0) / 1e9;
  }
  return 0;
}

/** 캐릭터 영상+음성을 speed 배로 (setpts/atempo). speed=1.0 이면 no-op(복사 안 함) */
export async function applySpeed(charPath: string, speed: number, outPath: string): Promise<void> {
  const ffmpeg = require('ffmpeg-static') as string;
  await execAsync(
    `"${ffmpeg}" -y -loglevel error -i "${charPath}" -filter:v "setpts=PTS/${speed}" -filter:a "atempo=${speed}" ` +
    `-c:v libx264 -preset ultrafast -threads 1 -pix_fmt yuv420p -c:a aac -ar 44100 "${outPath}"`,
  );
}

/** 오디오 피치 시프트(길이 보존, rubberband). semitones 반음 단위(아이·강아지 톤업용) */
export async function applyPitch(inPath: string, semitones: number, outPath: string): Promise<void> {
  const ffmpeg = require('ffmpeg-static') as string;
  const k = Math.pow(2, semitones / 12);
  await execAsync(`"${ffmpeg}" -y -loglevel error -i "${inPath}" -filter:a "rubberband=pitch=${k.toFixed(4)}" "${outPath}"`);
}

/** ffmpeg raw PCM → Google STT(v1 sync, 단어 타임오프셋). 실제 음성 단어 [{w,s,e}] */
export async function sttWords(charPath: string, tmpDir: string, tag: string): Promise<SttWord[]> {
  const apiKey = process.env.GOOGLE_STT_API_KEY || process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) throw new Error('STT API key not set');
  const ffmpeg = require('ffmpeg-static') as string;
  const pcm = path.join(tmpDir, `${tag}_stt.raw`);
  await execAsync(`"${ffmpeg}" -y -loglevel error -i "${charPath}" -vn -ac 1 -ar 16000 -f s16le -acodec pcm_s16le "${pcm}"`);
  const content = fs.readFileSync(pcm).toString('base64');
  try { fs.unlinkSync(pcm); } catch { /* noop */ }
  const res = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: { encoding: 'LINEAR16', sampleRateHertz: 16000, languageCode: 'ko-KR', enableWordTimeOffsets: true, enableAutomaticPunctuation: false },
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

/** Kling 오디오의 실제 발화 구간(무음 사이) — silencedetect */
export async function detectSpeechSegments(charPath: string, D: number): Promise<{ s: number; e: number }[]> {
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
  const silences = starts.map((s, i) => ({ s, e: ends[i] ?? D }));
  const speech: { s: number; e: number }[] = [];
  let cursor = 0;
  for (const sil of silences) {
    if (sil.s > cursor + 0.05) speech.push({ s: cursor, e: sil.s });
    cursor = Math.max(cursor, sil.e);
  }
  if (cursor < D - 0.05) speech.push({ s: cursor, e: D });
  return speech;
}

/**
 * 나레이션 + 실제 오디오(charPath) → 정렬된 자막 큐.
 * 1순위 STT 단어 앵커 정밀정렬 → 2순위 쉼정렬 → 3순위 글자수 비례.
 * (렌더는 호출측에서 각 큐 text 를 renderSubtitle 로 그림)
 */
/**
 * 시작시각 목록 → 자막 큐. 각 자막 end = 다음 자막 시작(겹침 없음).
 * 너무 짧은(<minDur) 자막은 이전 자막에 흡수(깜빡임·겹침 방지).
 */
function finalizeCues(starts: { s: number; text: string }[], D0: number, lead: number, minDur = 0.4): SubCue[] {
  const pts = starts.map((x) => ({ start: Math.max(0, x.s - lead), text: x.text }));
  const out: SubCue[] = [];
  for (let i = 0; i < pts.length; i++) {
    const start = pts[i].start;
    const nextStart = i + 1 < pts.length ? pts[i + 1].start : D0;
    const end = Math.min(D0, Math.max(start, nextStart)); // 절대 다음 시작을 넘지 않음
    if (out.length && end - start < minDur) {
      const prev = out[out.length - 1];
      prev.text = `${prev.text} ${pts[i].text}`.trim();
      prev.end = end;
    } else {
      out.push({ start, end, text: pts[i].text });
    }
  }
  return out;
}

export async function buildAlignedSubtitles(
  charPath: string, narration: string, D0: number, tmpDir: string, tag: string,
  opts?: { sttSource?: string; timeScale?: number },
): Promise<{ cues: SubCue[]; mode: string }> {
  const chunks = chunkForSubtitles(narration);
  if (!chunks.length) return { cues: [], mode: 'none' };

  // ── 1순위: STT 단어 타임스탬프 앵커 정밀정렬 ──
  // STT는 깨끗한 원본 오디오(피치·배속 전)로 돌리는 게 정확 → sttSource 지정 가능.
  // 그 오디오가 최종 영상과 시간축이 다르면 timeScale(=1/speed)로 시각 보정.
  const sttSrc = opts?.sttSource || charPath;
  const timeScale = opts?.timeScale ?? 1;
  let sw: SttWord[] = [];
  try {
    sw = await sttWords(sttSrc, tmpDir, tag);
    if (timeScale !== 1) sw = sw.map((w) => ({ w: w.w, s: w.s * timeScale, e: w.e * timeScale }));
  } catch (e) { console.error(`[subtitles ${tag}] STT 실패, 쉼정렬 폴백:`, e instanceof Error ? e.message : e); }

  if (sw.length >= 3) {
    const nWords = narration.split(/\s+/).filter(Boolean);
    const NW = nWords.length, SW = sw.length;
    const norm = (s: string) => s.replace(/[^가-힣a-zA-Z0-9]/g, '');
    const wordMatch = (a: string, b: string): boolean => {
      const x = norm(a), y = norm(b);
      if (!x || !y) return false;
      return x === y || x.startsWith(y) || y.startsWith(x) || (x.length >= 2 && y.length >= 2 && x.slice(0, 2) === y.slice(0, 2));
    };
    const anchors: { ni: number; t: number }[] = [];
    let ni = 0;
    for (let k = 0; k < SW; k++) {
      for (let j = ni; j < Math.min(ni + 7, NW); j++) {
        if (wordMatch(nWords[j], sw[k].w)) { anchors.push({ ni: j, t: sw[k].s }); ni = j + 1; break; }
      }
    }
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
      const first = anchors[0], last = anchors[anchors.length - 1];
      for (let j = 0; j < first.ni; j++) wordTime[j] = Math.max(0, first.t - (first.ni - j) * 0.28);
      for (let j = last.ni + 1; j < NW; j++) wordTime[j] = Math.min(D0, last.t + (j - last.ni) * 0.28);
    } else {
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
    const cues = finalizeCues(raw.map((x) => ({ s: x.sStart, text: x.text })), D0, LEAD);
    console.log(`[subtitles ${tag}] STT단어 ${SW} / 원고단어 ${NW} / 앵커 ${anchors.length} → 자막 ${cues.length}개 (stt-align)`);
    return { cues, mode: 'stt-align' };
  }

  // ── 2순위: 실제 쉼구간에 단어 시간비례 배정 ──
  const speech = await detectSpeechSegments(charPath, D0);
  const totalActive = speech.reduce((a, g) => a + (g.e - g.s), 0);
  const words = narration.split(/\s+/).filter(Boolean);
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
    const raw = speech.map((g, i) => ({ s: g.s, text: buckets[i].join(' ') })).filter((x) => x.text.length > 0);
    const cues = finalizeCues(raw, D0, CAPTION_LEAD);
    console.log(`[subtitles ${tag}] 폴백 segment-align: 발화구간 ${speech.length}개→자막 ${cues.length}개`);
    return { cues, mode: 'segment-align' };
  }

  // ── 3순위: 전체 길이에 글자수 비례 ──
  const totalC = chunks.reduce((a, c) => a + c.length, 0) || 1;
  let acc = 0;
  const cues = chunks.map((p) => {
    const dur = D0 * (p.length / totalC);
    const s = acc; acc += dur;
    return { start: s, end: acc, text: p };
  });
  return { cues, mode: 'proportional' };
}
