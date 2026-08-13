/**
 * 제품 홍보 "인터컷 + 코너 PiP" 합성.
 *  인트로(캐릭터 풀샷) → 중간(제품 배경 + 우하단 원형 캐릭터 + 제목/CTA) → 아웃트로(캐릭터 풀샷)
 * 텍스트/원형 마스크는 @napi-rs/canvas 로 PNG 렌더, 합성은 ffmpeg-static.
 */
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/** 마크다운/특수문자 제거 — TTS 가 '*' 를 "별표"로 읽는 문제 방지 */
export function sanitizeScript(text: string): string {
  return stripEmoji((text || '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, '')   // [text](url)
    .replace(/[*#`_~>|]/g, '')             // 마크다운 기호
    .replace(/\s{2,}/g, ' ')
    .trim());
}

const W = 1080, H = 1920;
// PiP 레이아웃 (동그라미 크게 + 머리 윗부분 안 짤리게 crop 을 맨 위부터)
export const PIP = 430;      // 원형 캐릭터 지름
export const RING = 452;     // 흰 테두리 포함 지름
export const CROP_Y = 120;   // 줌아웃 크롭 시작 y (머리~어깨/가슴 프레이밍)
const PIPX = W - RING - 44;  // 우하단
const PIPY = H - RING - 330;

function findFont(bold = false): string {
  const candidates = [
    ...(bold ? [path.join(process.cwd(), 'public/fonts/BlackHanSans-Regular.ttf')] : []),
    path.join(process.cwd(), 'public/fonts/NotoSansKR-Regular.ttf'),
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/System/Library/Fonts/AppleSDGothicNeo.ttc',
  ];
  for (const f of candidates) if (fs.existsSync(f)) return f;
  return '';
}

/** 이모지·기호 제거 (영상 텍스트용) */
export function stripEmoji(s: string): string {
  return (s || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{2122}\u{2139}\u{1F1E6}-\u{1F1FF}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** 텍스트를 maxW 안에서 최대 maxLines 줄로 그리디 줄바꿈. 넘치면 폰트 줄여 재시도. */
function fitLines(
  ctx: import('@napi-rs/canvas').SKRSContext2D,
  text: string, fontFamily: string, maxW: number, maxLines: number, startSize: number, minSize: number,
): { lines: string[]; size: number } {
  const words = text.split(/\s+/).filter(Boolean);
  for (let size = startSize; size >= minSize; size -= 4) {
    ctx.font = `${size}px "${fontFamily}"`;
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width <= maxW || !cur) cur = test;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxW)) return { lines, size };
  }
  // 최소 폰트로도 넘치면 그냥 반환(자를지언정)
  ctx.font = `${minSize}px "${fontFamily}"`;
  return { lines: [text], size: minSize };
}

async function registerFonts() {
  const { GlobalFonts } = await import('@napi-rs/canvas');
  const titleFont = findFont(true), bodyFont = findFont(false);
  const fams: { title: string; body: string } = { title: 'sans-serif', body: 'sans-serif' };
  try { if (titleFont) { GlobalFonts.registerFromPath(titleFont, 'PromoTitle'); fams.title = 'PromoTitle'; } } catch { /* noop */ }
  try { if (bodyFont) { GlobalFonts.registerFromPath(bodyFont, 'PromoBody'); fams.body = 'PromoBody'; } } catch { /* noop */ }
  return fams;
}

// shortsai 헤더 테마 재사용 (밴드배경 / 제품명색 / 홍보문구색 / 외곽선)
export interface HeaderThemeDef { bg: string; nameColor: string; titleColor: string; outline: string; }
const OUTLINE = 'rgba(0,0,0,0.85)';
export const HEADER_THEMES: Record<string, HeaderThemeDef> = {
  blur:     { bg: 'blur',    nameColor: '#FDE047', titleColor: '#FFFFFF', outline: OUTLINE },
  black:    { bg: '#121212', nameColor: '#FFE600', titleColor: '#FFFFFF', outline: OUTLINE },
  navy:     { bg: '#0A192F', nameColor: '#00E5FF', titleColor: '#FFFFFF', outline: OUTLINE },
  neon:     { bg: '#E5FF00', nameColor: '#14213D', titleColor: '#D32F2F', outline: 'rgba(0,0,0,0)' },
  violet:   { bg: '#1A0B2E', nameColor: '#FF2A85', titleColor: '#FFFFFF', outline: OUTLINE },
  burgundy: { bg: '#4A0E17', nameColor: '#FFC107', titleColor: '#FFFFFF', outline: OUTLINE },
};

function hexToRgba(hex: string, a: number): string {
  const m = hex.replace('#', '');
  const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export const HEADER_BAND_H = 340; // 고정 헤더 밴드 높이 (캐릭터는 이 아래에 배치)

/** 상단 헤더 밴드(고정 높이): 제품명(윗줄) + 홍보문구(아랫줄), 테마별 색·배경 */
export async function renderHeaderOverlay(businessName: string, catchphrase: string, themeId: string, outPath: string): Promise<void> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const fams = await registerFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const th = HEADER_THEMES[themeId] || HEADER_THEMES.blur;
  const BH = HEADER_BAND_H;

  const name = stripEmoji(businessName);
  const phrase = stripEmoji(catchphrase || '');
  const nameFit = fitLines(ctx, name, fams.title, W - 130, 2, 80, 48);
  const phraseFit = phrase ? fitLines(ctx, phrase, fams.body, W - 150, 2, 58, 38) : { lines: [] as string[], size: 0 };
  const nameLH = Math.round(nameFit.size * 1.14);
  const phraseLH = phraseFit.size ? Math.round(phraseFit.size * 1.2) : 0;
  const gap = phrase ? 22 : 0;
  const blockH = nameFit.lines.length * nameLH + gap + phraseFit.lines.length * phraseLH;

  // 배경 밴드 (고정 높이, 아래 가장자리 살짝 페이드)
  if (th.bg === 'blur') {
    ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(0, 0, W, BH);
    const g = ctx.createLinearGradient(0, BH - 40, 0, BH);
    g.addColorStop(0, 'rgba(0,0,0,0.8)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, BH - 40, W, 40);
  } else {
    ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, BH);
    const g = ctx.createLinearGradient(0, BH - 8, 0, BH + 34);
    g.addColorStop(0, hexToRgba(th.bg, 1)); g.addColorStop(1, hexToRgba(th.bg, 0));
    ctx.fillStyle = g; ctx.fillRect(0, BH - 8, W, 42);
  }

  ctx.textAlign = 'center';
  const drawRow = (text: string, y: number, size: number, fontFam: string, color: string) => {
    ctx.font = `${size}px "${fontFam}"`;
    if (th.outline !== 'rgba(0,0,0,0)') { ctx.lineWidth = Math.max(3, size * 0.09); ctx.strokeStyle = th.outline; ctx.lineJoin = 'round'; ctx.strokeText(text, W / 2, y); }
    ctx.fillStyle = color; ctx.fillText(text, W / 2, y);
  };
  // 밴드 안에서 세로 중앙 정렬
  let baseline = (BH - blockH) / 2 + nameFit.size * 0.82;
  nameFit.lines.forEach((ln) => { drawRow(ln, baseline, nameFit.size, fams.title, th.nameColor); baseline += nameLH; });
  if (phrase) {
    baseline = baseline - nameLH + gap + phraseFit.size;
    phraseFit.lines.forEach((ln) => { drawRow(ln, baseline, phraseFit.size, fams.body, th.titleColor); baseline += phraseLH; });
  }
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
}

/** 하단 CTA 오버레이 (제품 구간 + 마무리에 표시) */
export async function renderCtaOverlay(cta: string, outPath: string): Promise<void> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const fams = await registerFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, H - 320, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.63)');
  ctx.fillStyle = g; ctx.fillRect(0, H - 320, W, 320);
  ctx.textAlign = 'center';
  const clean = stripEmoji(cta);
  const { lines, size } = fitLines(ctx, clean, fams.body, W - 120, 2, 52, 36);
  const lineH = Math.round(size * 1.2);
  const startY = H - 150 - (lines.length - 1) * lineH;
  ctx.font = `${size}px "${fams.body}"`;
  lines.forEach((ln, i) => {
    const y = startY + i * lineH;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillText(ln, W / 2 + 2, y + 2);
    ctx.fillStyle = '#ffffff'; ctx.fillText(ln, W / 2, y);
  });
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
}

export const SUB_STRIP_H = 260;   // 자막 스트립 높이 (풀프레임 대신 → OOM 방지)
export const SUB_Y = 930;         // 합성에서 스트립을 얹을 y (박스 중앙 ≈ 1060)

/** 나레이션 자막 PNG (작은 스트립: 1080xSUB_STRIP_H 투명, 박스 없이 흰 글자 + 검은 외곽선) */
export async function renderSubtitle(text: string, outPath: string): Promise<void> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const fams = await registerFonts();
  const canvas = createCanvas(W, SUB_STRIP_H);
  const ctx = canvas.getContext('2d');
  const clean = stripEmoji(text);
  const { lines, size } = fitLines(ctx, clean, fams.body, W - 200, 2, 54, 38);
  const lineH = Math.round(size * 1.3);
  ctx.font = `${size}px "${fams.body}"`;
  let maxW = 0; lines.forEach((l) => { maxW = Math.max(maxW, ctx.measureText(l).width); });
  const bh = lines.length * lineH;
  const cy = SUB_STRIP_H / 2;
  // 박스 없이: 흰 글자 + 강한 검은 외곽선 (홍보영상 자막식)
  ctx.textAlign = 'center';
  let y = cy - bh / 2 + size * 0.8;
  lines.forEach((l) => {
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(6, size * 0.22); ctx.strokeStyle = 'rgba(0,0,0,0.92)'; ctx.strokeText(l, W / 2, y);
    ctx.fillStyle = '#ffffff'; ctx.fillText(l, W / 2, y);
    y += lineH;
  });
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
}

/** 원형 알파 마스크(PIP)와 흰 링(RING) PNG 생성 */
export async function renderPipAssets(maskPath: string, ringPath: string): Promise<void> {
  const { createCanvas } = await import('@napi-rs/canvas');
  // 알파 마스크: 검은 배경에 흰 원 (alphamerge 용)
  const m = createCanvas(PIP, PIP); const mc = m.getContext('2d');
  mc.fillStyle = '#000'; mc.fillRect(0, 0, PIP, PIP);
  mc.fillStyle = '#fff'; mc.beginPath(); mc.arc(PIP / 2, PIP / 2, PIP / 2, 0, Math.PI * 2); mc.fill();
  fs.writeFileSync(maskPath, m.toBuffer('image/png'));
  // 흰 링: 투명 배경에 흰 원 (테두리)
  const r = createCanvas(RING, RING); const rc = r.getContext('2d');
  rc.fillStyle = '#ffffff'; rc.beginPath(); rc.arc(RING / 2, RING / 2, RING / 2, 0, Math.PI * 2); rc.fill();
  fs.writeFileSync(ringPath, r.toBuffer('image/png'));
}

/**
 * ffmpeg 인터컷+PiP 합성. 구간: [0,t1) 캐릭터풀샷, [t1,t2) 제품+PiP, [t2,D) 캐릭터풀샷.
 * 2GB 서버 OOM 방지를 위해 **구간별로 짧게 인코딩 → 무손실 concat** (한 번에 전체를 메모리에 안 올림).
 */
export async function composePromoCharacter(opts: {
  productImagePath: string;
  characterVideoPath: string;
  headerPath: string;
  ctaPath: string;
  pipMaskPath: string;
  ringPath: string;
  durationSec: number;
  t1: number;
  t2: number;
  outPath: string;
  subtitles?: { path: string; start: number; end: number }[];
}): Promise<void> {
  const ffmpeg = require('ffmpeg-static') as string;
  const { productImagePath, characterVideoPath, headerPath, ctaPath, pipMaskPath, ringPath, durationSec, t1, t2, outPath } = opts;
  const subs = opts.subtitles || [];

  // ── 2-패스 구성 (OOM 방지) ──────────────────────────────────────────
  // 캐릭터 split→scale→concat(무거움)과 자막 다중 오버레이(무거움)를 한 그래프에
  // 넣으면 2GB 서버에서 OOM(Killed). 베이스 합성 → 자막 오버레이로 분리한다.

  // Pass A: 캐릭터 인터컷 + 제품 PiP + 헤더 + CTA → 베이스(자막 없음)
  // 입력: [0]제품 [1]캐릭터 [2]헤더 [3]CTA [4]마스크 [5]링
  const baseParts = [
    `[1:v]split=3[v1][v2][v3]`,
    // 인트로: 캐릭터를 헤더밴드 아래 영역에 채우고 + 헤더 밴드 위에
    `[v1]scale=${W}:${H - HEADER_BAND_H}:force_original_aspect_ratio=increase,crop=${W}:${H - HEADER_BAND_H},setsar=1,pad=${W}:${H}:0:${HEADER_BAND_H}:color=black[cf1a]`,
    `[cf1a][2:v]overlay=0:0[cf1]`,
    // 아웃트로: 캐릭터(헤더밴드 아래) + 헤더 + CTA
    `[v2]scale=${W}:${H - HEADER_BAND_H}:force_original_aspect_ratio=increase,crop=${W}:${H - HEADER_BAND_H},setsar=1,pad=${W}:${H}:0:${HEADER_BAND_H}:color=black[cf2a]`,
    `[cf2a][2:v]overlay=0:0[cf2b]`,
    `[cf2b][3:v]overlay=0:0[cf2]`,
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1[bgs]`,
    `[bgs][2:v]overlay=0:0[bgh]`,
    `[bgh][3:v]overlay=0:0[bgt]`,
    `[v3]pad=900:1280:90:0:color=white,crop=900:900:0:${CROP_Y},scale=${PIP}:${PIP}[pipraw]`,
    `[pipraw][4:v]alphamerge[pipc]`,
    `[5:v][pipc]overlay=(W-w)/2:(H-h)/2[pipring]`,
    `[bgt][pipring]overlay=${PIPX}:${PIPY}[mid]`,
    `[cf1]trim=0:${t1},setpts=PTS-STARTPTS[s1]`,
    `[mid]trim=${t1}:${t2},setpts=PTS-STARTPTS[s2]`,
    `[cf2]trim=${t2}:${durationSec},setpts=PTS-STARTPTS[s3]`,
    `[s1][s2][s3]concat=n=3:v=1[outv]`,
  ];
  // 자막이 있으면 베이스를 임시파일로, 없으면 바로 최종 출력으로
  const baseOut = subs.length ? `${outPath}.base.mp4` : outPath;
  const baseCmd = [
    `"${ffmpeg}" -y -loglevel error`,
    `-loop 1 -i "${productImagePath}"`,
    `-i "${characterVideoPath}"`,
    `-loop 1 -i "${headerPath}"`,
    `-loop 1 -i "${ctaPath}"`,
    `-loop 1 -i "${pipMaskPath}"`,
    `-loop 1 -i "${ringPath}"`,
    `-filter_complex "${baseParts.join(';')}"`,
    `-map "[outv]" -map "1:a?" -r 30`,
    // OOM 방지: ultrafast + 단일 스레드 (libx264 lookahead 버퍼가 2GB 서버 OOM 주범)
    `-c:v libx264 -pix_fmt yuv420p -preset ultrafast -threads 1 -g 60`,
    `-c:a aac -ar 44100 -movflags +faststart`,
    `"${baseOut}"`,
  ].join(' ');
  await execAsync(baseCmd, { maxBuffer: 1024 * 1024 * 64 });

  if (!subs.length) return;

  // Pass B: 베이스 위에 자막 스트립 오버레이 (시점별 enable=between)
  // 입력: [0]베이스, [1..]=자막. 오디오는 베이스에서 그대로 복사(재인코딩 X)
  const subParts: string[] = [];
  let prev = '0:v';
  subs.forEach((s, i) => {
    const out = i === subs.length - 1 ? 'outv' : `sub${i}`;
    subParts.push(`[${prev}][${1 + i}:v]overlay=0:${SUB_Y}:enable='between(t,${s.start.toFixed(2)},${s.end.toFixed(2)})'[${out}]`);
    prev = out;
  });
  // 자막 입력은 반드시 -t 로 길이 제한 (무한 loop 이면 ffmpeg hang)
  const subInputs = subs.map((s) => `-loop 1 -t ${durationSec.toFixed(2)} -i "${s.path}"`).join(' ');
  const subCmd = [
    `"${ffmpeg}" -y -loglevel error`,
    `-i "${baseOut}"`,
    subInputs,
    `-filter_complex "${subParts.join(';')}"`,
    `-map "[outv]" -map "0:a?" -r 30`,
    `-c:v libx264 -pix_fmt yuv420p -preset ultrafast -threads 1 -g 60`,
    `-c:a copy -movflags +faststart`,
    `"${outPath}"`,
  ].join(' ');
  await execAsync(subCmd, { maxBuffer: 1024 * 1024 * 64 });
  try { fs.unlinkSync(baseOut); } catch { /* noop */ }
}

/** 파일 길이(초) — ffmpeg-static 엔 ffprobe 가 없어 `ffmpeg -i` stderr 의 Duration 파싱 */
export async function probeDuration(filePath: string): Promise<number> {
  const ffmpeg = require('ffmpeg-static') as string;
  try {
    await execAsync(`"${ffmpeg}" -i "${filePath}"`);
    return 0;
  } catch (e) {
    const out = String((e as { stderr?: string; stdout?: string; message?: string })?.stderr
      || (e as { stdout?: string })?.stdout || (e as Error)?.message || '');
    const m = out.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
    if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
    return 0;
  }
}
