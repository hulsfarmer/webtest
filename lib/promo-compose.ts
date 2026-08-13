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
  return (text || '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, '')   // [text](url)
    .replace(/[*#`_~>|]/g, '')             // 마크다운 기호
    .replace(/\s{2,}/g, ' ')
    .trim();
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
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu, '')
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

/** 상단 헤더: 제품명(윗줄) + 홍보문구(아랫줄), 테마별 색·배경. 길면 각 2줄 */
export async function renderHeaderOverlay(businessName: string, catchphrase: string, themeId: string, outPath: string): Promise<void> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const fams = await registerFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const th = HEADER_THEMES[themeId] || HEADER_THEMES.blur;

  const name = stripEmoji(businessName);
  const phrase = stripEmoji(catchphrase || '');
  const nameFit = fitLines(ctx, name, fams.title, W - 130, 2, 82, 50);
  const phraseFit = phrase ? fitLines(ctx, phrase, fams.body, W - 150, 2, 60, 40) : { lines: [] as string[], size: 0 };
  const nameLH = Math.round(nameFit.size * 1.16);
  const phraseLH = phraseFit.size ? Math.round(phraseFit.size * 1.22) : 0;
  const topPad = 66, gap = phrase ? 24 : 0, botPad = 44;
  const bandH = topPad + nameFit.lines.length * nameLH + gap + phraseFit.lines.length * phraseLH + botPad;

  // 배경 밴드
  if (th.bg === 'blur') {
    const g = ctx.createLinearGradient(0, 0, 0, bandH + 70);
    g.addColorStop(0, 'rgba(0,0,0,0.72)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, bandH + 70);
  } else {
    ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, bandH);
    const g = ctx.createLinearGradient(0, bandH, 0, bandH + 46);
    g.addColorStop(0, hexToRgba(th.bg, 1)); g.addColorStop(1, hexToRgba(th.bg, 0));
    ctx.fillStyle = g; ctx.fillRect(0, bandH, W, 46);
  }

  ctx.textAlign = 'center';
  const drawRow = (text: string, y: number, size: number, fontFam: string, color: string) => {
    ctx.font = `${size}px "${fontFam}"`;
    if (th.outline !== 'rgba(0,0,0,0)') { ctx.lineWidth = Math.max(3, size * 0.09); ctx.strokeStyle = th.outline; ctx.lineJoin = 'round'; ctx.strokeText(text, W / 2, y); }
    ctx.fillStyle = color; ctx.fillText(text, W / 2, y);
  };
  // 제품명 블록
  let baseline = topPad + nameFit.size * 0.82;
  nameFit.lines.forEach((ln) => { drawRow(ln, baseline, nameFit.size, fams.title, th.nameColor); baseline += nameLH; });
  // 홍보문구 블록
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
}): Promise<void> {
  const ffmpeg = require('ffmpeg-static') as string;
  const { productImagePath, characterVideoPath, headerPath, ctaPath, pipMaskPath, ringPath, durationSec, t1, t2, outPath } = opts;

  // 입력: [0]제품 [1]캐릭터 [2]헤더 [3]CTA [4]마스크 [5]링
  const filter = [
    `[1:v]split=3[v1][v2][v3]`,
    // 인트로: 캐릭터풀샷 + 헤더
    `[v1]scale=${W}:${H},setsar=1[cf1a]`,
    `[cf1a][2:v]overlay=0:0[cf1]`,
    // 아웃트로: 캐릭터풀샷 + 헤더 + CTA
    `[v2]scale=${W}:${H},setsar=1[cf2a]`,
    `[cf2a][2:v]overlay=0:0[cf2b]`,
    `[cf2b][3:v]overlay=0:0[cf2]`,
    // 중간 배경: 제품(원래 비율 전체표시, 흰 여백) + 헤더 + CTA
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1[bgs]`,
    `[bgs][2:v]overlay=0:0[bgh]`,
    `[bgh][3:v]overlay=0:0[bgt]`,
    // 코너 원형 PiP (폭 패드로 줌아웃 → 머리~어깨/가슴, 원에 맞춰 정사각)
    `[v3]pad=900:1280:90:0:color=white,crop=900:900:0:${CROP_Y},scale=${PIP}:${PIP}[pipraw]`,
    `[pipraw][4:v]alphamerge[pipc]`,
    `[5:v][pipc]overlay=(W-w)/2:(H-h)/2[pipring]`,
    `[bgt][pipring]overlay=${PIPX}:${PIPY}[mid]`,
    // 구간 합치기
    `[cf1]trim=0:${t1},setpts=PTS-STARTPTS[s1]`,
    `[mid]trim=${t1}:${t2},setpts=PTS-STARTPTS[s2]`,
    `[cf2]trim=${t2}:${durationSec},setpts=PTS-STARTPTS[s3]`,
    `[s1][s2][s3]concat=n=3:v=1[outv]`,
  ].join(';');

  // OOM 방지: ultrafast + 단일 스레드 (libx264 lookahead 버퍼가 2GB 서버 OOM 주범)
  const cmd = [
    `"${ffmpeg}" -y -loglevel error`,
    `-loop 1 -i "${productImagePath}"`,
    `-i "${characterVideoPath}"`,
    `-loop 1 -i "${headerPath}"`,
    `-loop 1 -i "${ctaPath}"`,
    `-loop 1 -i "${pipMaskPath}"`,
    `-loop 1 -i "${ringPath}"`,
    `-filter_complex "${filter}"`,
    `-map "[outv]" -map "1:a?" -r 30`,
    `-c:v libx264 -pix_fmt yuv420p -preset ultrafast -threads 1 -g 60`,
    `-c:a aac -ar 44100 -movflags +faststart`,
    `"${outPath}"`,
  ].join(' ');

  await execAsync(cmd, { maxBuffer: 1024 * 1024 * 64 });
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
