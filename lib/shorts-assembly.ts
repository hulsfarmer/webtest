// lib/shorts-assembly.ts
// 후킹형 제휴 쇼츠 조립: Seedance 클립 2개 + 글로우 자막 + 배경음악 → 1080x1920 mp4.
//
// - 자막: @napi-rs/canvas (native shadowBlur 로 글로우), 박스·밑줄 없음, *키워드* 시안 강조.
// - 합성: ffmpeg-static + exec. 2GB 서버 OOM 방지 위해 promo-compose 와 동일하게
//   ultrafast·threads 1·2패스, 무거운 단일 그래프 회피.

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const W = 1080;
const H = 1920;
const FPS = 30;
const ACCENT = '#3cd6ff';
const WHITE = '#ffffff';

function ffmpegBin(): string {
  return require('ffmpeg-static') as string;
}

function firstExisting(cands: string[]): string {
  for (const c of cands) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {
      /* noop */
    }
  }
  return '';
}

// promo-compose 와 동일한 한글 폰트 후보 (public/fonts + 서버 Noto CJK)
function findBoldFont(): string {
  return firstExisting([
    path.join(process.cwd(), 'public/fonts/BlackHanSans-Regular.ttf'),
    path.join(process.cwd(), 'public/fonts/NotoSansKR-Bold.ttf'),
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc',
    '/System/Library/Fonts/AppleSDGothicNeo.ttc',
    path.join(process.cwd(), 'public/fonts/NotoSansKR-Regular.ttf'),
  ]);
}

let fontRegistered = false;
async function registerCaptionFont(): Promise<string> {
  const { GlobalFonts } = await import('@napi-rs/canvas');
  if (!fontRegistered) {
    const f = findBoldFont();
    if (f) {
      try {
        GlobalFonts.registerFromPath(f, 'ShortsCaption');
        fontRegistered = true;
      } catch {
        /* noop */
      }
    }
  }
  return fontRegistered ? 'ShortsCaption' : 'sans-serif';
}

// "매일 뛰는데 *발이 아프다면?*" → [{t:'매일 뛰는데 ',accent:false},{t:'발이 아프다면?',accent:true}]
function parseSegments(text: string): { t: string; accent: boolean }[] {
  const out: { t: string; accent: boolean }[] = [];
  const re = /\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: text.slice(last, m.index), accent: false });
    out.push({ t: m[1], accent: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), accent: false });
  return out.length ? out : [{ t: text, accent: false }];
}

/** 글로우 자막 PNG 렌더 (1080x1920 투명, 박스·밑줄 없음). */
export async function renderGlowCaption(
  text: string,
  outPath: string,
  opts: { cy?: number; maxSize?: number } = {}
): Promise<void> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const fam = await registerCaptionFont();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const segs = parseSegments(text);
  const cy = opts.cy ?? 1480;
  const maxSize = opts.maxSize ?? 92;

  // 폭에 맞춰 폰트 크기 자동 축소
  let size = maxSize;
  const measure = (s: number) => {
    ctx.font = `${s}px "${fam}"`;
    return segs.reduce((w, seg) => w + ctx.measureText(seg.t).width, 0);
  };
  while (size > 44 && measure(size) > W - 140) size -= 4;
  ctx.font = `${size}px "${fam}"`;

  const total = measure(size);
  let x = (W - total) / 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  // native glow
  ctx.shadowColor = 'rgba(0,12,26,0.95)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  for (const seg of segs) {
    ctx.fillStyle = seg.accent ? ACCENT : WHITE;
    ctx.fillText(seg.t, x, cy);
    x += ctx.measureText(seg.t).width;
  }
  await fs.promises.writeFile(outPath, canvas.toBuffer('image/png'));
}

/** CTA 자막 PNG: 브랜드(흰) 위 + 액션(시안, ▸ 삼각형) 아래. */
export async function renderCtaCaption(
  brand: string,
  action: string,
  outPath: string
): Promise<void> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const fam = await registerCaptionFont();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,12,26,0.95)';
  ctx.shadowBlur = 16;

  ctx.font = `64px "${fam}"`;
  ctx.fillStyle = WHITE;
  ctx.fillText(brand, W / 2, 1420);

  // 삼각형 + 액션
  ctx.font = `84px "${fam}"`;
  const aw = ctx.measureText(action).width;
  const triW = 46;
  const gap = 26;
  const blockW = triW + gap + aw;
  const x0 = (W - blockW) / 2;
  const ay = 1540;
  ctx.fillStyle = ACCENT;
  // 삼각형 (▸)
  ctx.beginPath();
  ctx.moveTo(x0, ay - 34);
  ctx.lineTo(x0, ay + 34);
  ctx.lineTo(x0 + triW, ay);
  ctx.closePath();
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.fillText(action, x0 + triW + gap, ay);

  await fs.promises.writeFile(outPath, canvas.toBuffer('image/png'));
}

export interface TimedCaption {
  pngPath: string;
  start: number;
  end: number;
}

export interface AssembleInput {
  /** Seedance 클립 경로 2개 (각 ~8초) */
  clipPaths: [string, string];
  /** 타이밍된 자막 PNG들 (CTA 포함) */
  captions: TimedCaption[];
  /** 배경음악 mp3 경로 */
  musicPath: string;
  /** 최종 출력 경로 */
  outPath: string;
  /** 임시파일 prefix (예: /tmp/jobId) */
  tmpPrefix: string;
  /** 크로스페이드 오프셋(초). 기본 7.54 (8초 클립 A 끝) */
  xfadeOffset?: number;
  /** 최종 길이(초). 기본 15.5 */
  totalDuration?: number;
}

/** 클립 2개 + 자막 + 음악 → 최종 mp4 (2패스, OOM-safe). */
export async function assembleShort(input: AssembleInput): Promise<void> {
  const ffmpeg = ffmpegBin();
  const off = input.xfadeOffset ?? 7.54;
  const dur = input.totalDuration ?? 15.5;
  const base = `${input.tmpPrefix}_stitch.mp4`;

  // ── Pass 1: 클립 정규화(1080x1920,30fps) + xfade → base (영상만) ──
  const p1 = [
    `[0:v]scale=${W}:${H},setsar=1,fps=${FPS}[a]`,
    `[1:v]scale=${W}:${H},setsar=1,fps=${FPS}[b]`,
    `[a][b]xfade=transition=fade:duration=0.5:offset=${off}[v]`,
  ].join(';');
  const cmd1 = [
    `"${ffmpeg}" -y -loglevel error`,
    `-i "${input.clipPaths[0]}"`,
    `-i "${input.clipPaths[1]}"`,
    `-filter_complex "${p1}"`,
    `-map "[v]" -an -r ${FPS}`,
    `-c:v libx264 -pix_fmt yuv420p -preset ultrafast -threads 1 -g 60`,
    `-movflags +faststart`,
    `"${base}"`,
  ].join(' ');
  await execAsync(cmd1, { maxBuffer: 1024 * 1024 * 64 });

  // ── Pass 2: 자막 오버레이 + 음악(2단 압축·리미터로 라우드) 믹스 → 최종 ──
  const capInputs = input.captions.map((c) => `-loop 1 -i "${c.pngPath}"`).join(' ');
  const overlays: string[] = [];
  let cur = '0:v';
  input.captions.forEach((c, i) => {
    const idx = i + 2; // 0=base, 1=music, 2.. = captions
    const outLbl = i === input.captions.length - 1 ? 'v' : `ov${i}`;
    overlays.push(
      `[${cur}][${idx}:v]overlay=0:0:enable='between(t,${c.start},${c.end})'[${outLbl}]`
    );
    cur = outLbl;
  });
  const audio =
    `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,` +
    `acompressor=threshold=0.031:ratio=8:attack=5:release=80:makeup=9,` +
    `acompressor=threshold=0.12:ratio=4:makeup=2,alimiter=limit=0.98,` +
    `afade=t=in:st=0:d=0.3,atrim=0:${dur},afade=t=out:st=${(dur - 0.6).toFixed(2)}:d=0.55[au]`;
  const p2 = [...overlays, audio].join(';');
  const cmd2 = [
    `"${ffmpeg}" -y -loglevel error`,
    `-i "${base}"`,
    `-i "${input.musicPath}"`,
    capInputs,
    `-filter_complex "${p2}"`,
    `-map "[v]" -map "[au]" -r ${FPS} -t ${dur}`,
    `-c:v libx264 -pix_fmt yuv420p -preset ultrafast -threads 1 -g 60`,
    `-c:a aac -b:a 192k -ar 44100 -movflags +faststart`,
    `"${input.outPath}"`,
  ].join(' ');
  await execAsync(cmd2, { maxBuffer: 1024 * 1024 * 64 });

  try {
    fs.unlinkSync(base);
  } catch {
    /* noop */
  }
}
