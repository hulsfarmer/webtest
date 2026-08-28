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

/** 자막용 굵은 고딕 (홍보영상과 동일: NotoSansCJK-Bold 우선) */
function findSubFont(): string {
  const candidates = [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc',
    path.join(process.cwd(), 'public/fonts/NotoSansKR-Bold.ttf'),
    '/System/Library/Fonts/AppleSDGothicNeo.ttc',
    path.join(process.cwd(), 'public/fonts/NotoSansKR-Regular.ttf'),
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
  const titleFont = findFont(true), bodyFont = findFont(false), subFont = findSubFont();
  const fams: { title: string; body: string; sub: string } = { title: 'sans-serif', body: 'sans-serif', sub: 'sans-serif' };
  try { if (titleFont) { GlobalFonts.registerFromPath(titleFont, 'PromoTitle'); fams.title = 'PromoTitle'; } } catch { /* noop */ }
  try { if (bodyFont) { GlobalFonts.registerFromPath(bodyFont, 'PromoBody'); fams.body = 'PromoBody'; } } catch { /* noop */ }
  try { if (subFont) { GlobalFonts.registerFromPath(subFont, 'PromoSub'); fams.sub = 'PromoSub'; } } catch { /* noop */ }
  if (fams.sub === 'sans-serif') fams.sub = fams.body; // 폴백
  return fams;
}

// shortsai 헤더 테마 재사용 (밴드배경 / 제품명색 / 홍보문구색 / 외곽선)
export interface HeaderThemeDef { bg: string; nameColor: string; titleColor: string; outline: string; }
const OUTLINE = 'rgba(0,0,0,0.85)';
export const HEADER_THEMES: Record<string, HeaderThemeDef> = {
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
  const th = HEADER_THEMES[themeId] || HEADER_THEMES.navy;
  const BH = HEADER_BAND_H;

  // 이모지 + 마크다운 강조기호(*#`_~) 제거 (AI 캐치타이틀의 *강조* 별표가 헤더에 노출되던 문제)
  const stripMd = (s: string) => stripEmoji(s).replace(/[*#`_~]/g, '').replace(/\s{2,}/g, ' ').trim();
  const name = stripMd(businessName);
  const phrase = stripMd(catchphrase || '');
  // 제품명·홍보문구를 같은 크기로. 각 ≤2줄 + 전체 높이가 밴드 이내가 되는 최대 폰트 탐색
  // (제품명 2줄+홍보문구 2줄=4줄이어도 밴드 안에 들어오게 자동 축소 → 위 잘림 방지)
  const MAXW = W - 130, BAND_PAD = 30;
  const TOP_SAFE = 90; // 유튜브 쇼츠·인스타 릴스 상단 크롭/UI 대비 상단 여백 → 제목을 아래로
  const wrapAt = (text: string, size: number): string[] => {
    ctx.font = `${size}px "${fams.title}"`;
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(t).width <= MAXW || !cur) cur = t;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const hasName = !!name;
  // 문구 단독(제품1/2)은 더 크게, 제품명+문구(hedra·recompose)는 4줄 기준으로 폰트 자동 축소
  const MAXFONT = hasName ? 80 : 96;
  let hSize = 42, nameLines: string[] = hasName ? wrapAt(name, 42) : [], phraseLines = phrase ? wrapAt(phrase, 42) : [];
  for (let s = MAXFONT; s >= 42; s -= 2) {
    const nl = hasName ? wrapAt(name, s) : [];
    const pl = phrase ? wrapAt(phrase, s) : [];
    const lineH = s * 1.16;
    const accent = hasName ? 0 : Math.round(s * 0.55); // 문구 단독: 악센트 바 + 여백 공간 확보
    const bh = nl.length * lineH + (hasName && phrase ? 22 : 0) + pl.length * lineH + accent;
    if (nl.length <= 2 && pl.length <= 2 && bh <= BH - TOP_SAFE - BAND_PAD) { hSize = s; nameLines = nl; phraseLines = pl; break; }
  }
  const nameFit = { lines: nameLines, size: hSize };
  const phraseFit = { lines: phraseLines, size: phrase ? hSize : 0 };
  const nameLH = Math.round(hSize * 1.14);
  const phraseLH = phrase ? Math.round(hSize * 1.2) : 0;

  // 배경 밴드 (고정 높이, 아래 가장자리 살짝 페이드)
  ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, BH);
  const g = ctx.createLinearGradient(0, BH - 8, 0, BH + 34);
  g.addColorStop(0, hexToRgba(th.bg, 1)); g.addColorStop(1, hexToRgba(th.bg, 0));
  ctx.fillStyle = g; ctx.fillRect(0, BH - 8, W, 42);

  ctx.textAlign = 'center';
  const drawRow = (text: string, y: number, size: number, fontFam: string, color: string) => {
    ctx.font = `${size}px "${fontFam}"`;
    if (th.outline !== 'rgba(0,0,0,0)') { ctx.lineWidth = Math.max(3, size * 0.09); ctx.strokeStyle = th.outline; ctx.lineJoin = 'round'; ctx.strokeText(text, W / 2, y); }
    ctx.fillStyle = color; ctx.fillText(text, W / 2, y);
  };

  if (hasName) {
    // 제품명 + 홍보문구 (2단): 기존 레이아웃 (hedra·recompose)
    const gap = phrase ? 22 : 0;
    const blockH = nameFit.lines.length * nameLH + gap + phraseFit.lines.length * phraseLH;
    let baseline = TOP_SAFE + (BH - TOP_SAFE - blockH) / 2 + nameFit.size * 0.82;
    nameFit.lines.forEach((ln) => { drawRow(ln, baseline, nameFit.size, fams.title, th.nameColor); baseline += nameLH; });
    if (phrase) {
      baseline = baseline - nameLH + gap + phraseFit.size;
      phraseFit.lines.forEach((ln) => { drawRow(ln, baseline, phraseFit.size, fams.title, th.titleColor); baseline += phraseLH; });
    }
  } else {
    // 홍보문구 단독 (제품1/2): 상단 포인트색 악센트 바 + 큼직한 문구, 세로 중앙 정렬
    const accentH = Math.max(5, Math.round(hSize * 0.14));
    const accentW = Math.round(Math.min(150, Math.max(76, hSize * 1.6)));
    const accentGap = Math.round(hSize * 0.44);
    const blockH = accentH + accentGap + phraseFit.lines.length * phraseLH;
    let y = TOP_SAFE + (BH - TOP_SAFE - blockH) / 2;
    ctx.fillStyle = th.nameColor;
    const bx = Math.round(W / 2 - accentW / 2);
    const rr = (ctx as unknown as { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect;
    if (typeof rr === 'function') { ctx.beginPath(); rr.call(ctx, bx, y, accentW, accentH, accentH / 2); ctx.fill(); }
    else ctx.fillRect(bx, y, accentW, accentH);
    y += accentH + accentGap + phraseFit.size * 0.82;
    phraseFit.lines.forEach((ln) => { drawRow(ln, y, phraseFit.size, fams.title, th.titleColor); y += phraseLH; });
  }
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
}

/** 하단 CTA 오버레이 (제품 구간 + 마무리에 표시). CTA 비어있으면 투명(표시 안 함) */
export async function renderCtaOverlay(cta: string, outPath: string): Promise<void> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const clean = stripEmoji(cta || '').replace(/[*#`_~]/g, '').trim();
  if (!clean) { fs.writeFileSync(outPath, canvas.toBuffer('image/png')); return; } // 빈 CTA → 투명
  const fams = await registerFonts();
  const g = ctx.createLinearGradient(0, H - 320, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.63)');
  ctx.fillStyle = g; ctx.fillRect(0, H - 320, W, 320);
  ctx.textAlign = 'center';
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
export const SUB_Y = 1500;        // 스트립 y: 더 하단(얼굴·제품 안 가림)

/** 나레이션 자막 PNG (홍보영상식: 볼드 크림화이트 + 부드러운 그림자 + 얇은 외곽선) */
export async function renderSubtitle(text: string, outPath: string): Promise<void> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const fams = await registerFonts();
  const canvas = createCanvas(W, SUB_STRIP_H);
  const ctx = canvas.getContext('2d');
  const clean = stripEmoji(text);
  const { lines, size } = fitLines(ctx, clean, fams.sub, W - 140, 2, 72, 50);
  const lineH = Math.round(size * 1.32);
  ctx.font = `${size}px "${fams.sub}"`;
  const bh = lines.length * lineH;
  const cy = SUB_STRIP_H / 2;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  let y = cy - bh / 2 + size * 0.8;
  lines.forEach((l) => {
    // 1) 부드러운 그림자 + 얇은 어두운 외곽선 (밝은 제품 배경 위에서도 가독)
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;
    ctx.lineWidth = Math.max(4, size * 0.13);
    ctx.strokeStyle = 'rgba(0,0,0,0.82)';
    ctx.strokeText(l, W / 2, y);
    // 2) 크림 화이트 본문 (그림자 없이 크리스프하게)
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = '#FFFBEB';
    ctx.fillText(l, W / 2, y);
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
  //
  // ⚠ split=3 + concat(trim) 방식은 긴 영상에서 OOM: concat 이 첫 세그먼트를
  //   끝까지 읽는 동안 split 이 t1 구간(≈16s×30fps)의 캐릭터 프레임을 통째로
  //   버퍼링(≈1.3GB) → Killed. 대신 캐릭터를 단일 타임라인으로 두고 중간 구간만
  //   enable=between 오버레이로 덮는다(모든 분기가 같은 속도로 진행 → 버퍼 없음).
  const baseParts = [
    // 캐릭터: PiP용 1개만 split (2-way, lockstep 이라 버퍼 최소)
    `[1:v]split=2[cmain][cpip]`,
    // 캐릭터를 헤더밴드 아래 영역에 채움 (전 구간 = 인트로/아웃트로 배경)
    // crop 을 위쪽 고정(y=0)으로 → 머리 위가 안 잘리고 아래(어깨/몸통)만 잘림
    `[cmain]scale=${W}:${H - HEADER_BAND_H}:force_original_aspect_ratio=increase,crop=${W}:${H - HEADER_BAND_H}:0:0,setsar=1,pad=${W}:${H}:0:${HEADER_BAND_H}:color=black[cbase]`,
    // 제품 풀프레임(흰 여백 contain) — 중간 구간에만 덮음
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1[prod]`,
    // 코너 원형 PiP(캐릭터) + 흰 링
    // ⚠ Kling이 9:16이 아닌 크기(예: 960x944 정사각)를 반환할 수 있어, 먼저 720x1280로
    //   정규화(cover+crop)한다. 그래야 아래 pad=900:1280:90(=(900-720)/2) 가정이 항상 성립.
    //   정상 프리셋(720x1280)엔 no-op.
    `[cpip]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,pad=900:1280:90:0:color=white,crop=900:900:0:${CROP_Y},scale=${PIP}:${PIP}[pipraw]`,
    `[pipraw][4:v]alphamerge[pipc]`,
    `[5:v][pipc]overlay=(W-w)/2:(H-h)/2[pipring]`,
    // 타임라인 합성: 중간[t1,t2]엔 제품+PiP, 헤더는 항상 위, CTA는 아웃트로[t2,D]
    `[cbase][prod]overlay=0:0:enable='between(t,${t1},${t2})'[m1]`,
    `[m1][pipring]overlay=${PIPX}:${PIPY}:enable='between(t,${t1},${t2})'[m2]`,
    `[m2][2:v]overlay=0:0[m3]`,
    `[m3][3:v]overlay=0:0:enable='between(t,${t2},${durationSec})'[outv]`,
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
    `-map "[outv]" -map "1:a?" -r 30 -t ${durationSec}`,
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

/**
 * 구간별 캐릭터 on/off용 — 한 구간(인트로/제품/마무리) 독립 클립 생성(1080x1920).
 * charVideoPath 있으면 캐릭터(인트로·아웃트로=풀샷, 제품=코너 PiP), 없으면 제품+헤더만.
 * 구간별로 짧게 인코딩 → OOM 안전. 오디오=캐릭터영상 오디오(립싱크 동기) 또는 Gemini 오디오.
 */
export async function buildSegmentClip(opts: {
  kind: 'intro' | 'product' | 'outro';
  charVideoPath?: string;
  audioPath: string;
  productImagePath: string;
  headerPath: string;
  ctaPath?: string;
  pipMaskPath: string;
  ringPath: string;
  durationSec: number;
  subtitles?: { path: string; start: number; end: number }[];
  outPath: string;
}): Promise<void> {
  const ffmpeg = require('ffmpeg-static') as string;
  const { kind, charVideoPath, audioPath, productImagePath, headerPath, ctaPath, pipMaskPath, ringPath, durationSec, outPath } = opts;
  const subs = opts.subtitles || [];
  const charOn = !!charVideoPath;
  const isProduct = kind === 'product';
  const showCta = kind === 'outro' && !!ctaPath;

  const inputs: string[] = [];
  const idx: Record<string, number> = {};
  const addInput = (arg: string, key: string) => { idx[key] = inputs.length; inputs.push(arg); };
  addInput(`-loop 1 -i "${productImagePath}"`, 'prod');
  if (charOn) addInput(`-i "${charVideoPath}"`, 'char');
  addInput(`-loop 1 -i "${headerPath}"`, 'header');
  if (showCta) addInput(`-loop 1 -i "${ctaPath}"`, 'cta');
  if (charOn && isProduct) { addInput(`-loop 1 -i "${pipMaskPath}"`, 'mask'); addInput(`-loop 1 -i "${ringPath}"`, 'ring'); }

  const parts: string[] = [];
  const prodBg = () => parts.push(`[${idx.prod}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1[prodbg]`);
  let vlabel: string;
  if (charOn && !isProduct) {
    // 인트로/아웃트로 캐릭터 풀샷 (제품 배경 미사용)
    parts.push(`[${idx.char}:v]scale=${W}:${H - HEADER_BAND_H}:force_original_aspect_ratio=increase,crop=${W}:${H - HEADER_BAND_H}:0:0,setsar=1,pad=${W}:${H}:0:${HEADER_BAND_H}:color=black[base0]`);
    vlabel = 'base0';
  } else if (charOn && isProduct) {
    prodBg();
    parts.push(`[${idx.char}:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,pad=900:1280:90:0:color=white,crop=900:900:0:${CROP_Y},scale=${PIP}:${PIP}[pipraw]`);
    parts.push(`[pipraw][${idx.mask}:v]alphamerge[pipc]`);
    parts.push(`[${idx.ring}:v][pipc]overlay=(W-w)/2:(H-h)/2[pipring]`);
    parts.push(`[prodbg][pipring]overlay=${PIPX}:${PIPY}[base0]`);
    vlabel = 'base0';
  } else {
    // 캐릭터 없음 = 제품 배경만
    prodBg();
    vlabel = 'prodbg';
  }
  parts.push(`[${vlabel}][${idx.header}:v]overlay=0:0[vh]`); vlabel = 'vh';
  if (showCta) { parts.push(`[${vlabel}][${idx.cta}:v]overlay=0:0[vc]`); vlabel = 'vc'; }

  let audioMap: string;
  if (charOn) { audioMap = `${idx.char}:a?`; }
  else { addInput(`-i "${audioPath}"`, 'audio'); audioMap = `${idx.audio}:a?`; }

  const baseOut = subs.length ? `${outPath}.base.mp4` : outPath;
  await execAsync([
    `"${ffmpeg}" -y -loglevel error`, inputs.join(' '),
    `-filter_complex "${parts.join(';')}"`,
    `-map "[${vlabel}]" -map "${audioMap}" -r 30 -t ${durationSec.toFixed(2)}`,
    `-c:v libx264 -pix_fmt yuv420p -preset ultrafast -threads 1 -g 60`,
    `-c:a aac -ar 44100 -movflags +faststart`, `"${baseOut}"`,
  ].join(' '), { maxBuffer: 1024 * 1024 * 64 });

  if (!subs.length) return;
  const subInputs = subs.map((s) => `-loop 1 -t ${durationSec.toFixed(2)} -i "${s.path}"`).join(' ');
  const subParts: string[] = [];
  let prev = '0:v';
  subs.forEach((s, i) => {
    const out = i === subs.length - 1 ? 'outv' : `sub${i}`;
    subParts.push(`[${prev}][${1 + i}:v]overlay=0:${SUB_Y}:enable='between(t,${s.start.toFixed(2)},${s.end.toFixed(2)})'[${out}]`);
    prev = out;
  });
  await execAsync([
    `"${ffmpeg}" -y -loglevel error`, `-i "${baseOut}"`, subInputs,
    `-filter_complex "${subParts.join(';')}"`,
    `-map "[outv]" -map "0:a?" -r 30`,
    `-c:v libx264 -pix_fmt yuv420p -preset ultrafast -threads 1 -g 60`,
    `-c:a copy -movflags +faststart`, `"${outPath}"`,
  ].join(' '), { maxBuffer: 1024 * 1024 * 64 });
  try { fs.unlinkSync(baseOut); } catch { /* noop */ }
}

/** 여러 구간 클립을 하나로 이어붙임(재인코딩, 포맷 통일). */
export async function concatSegments(paths: string[], outPath: string): Promise<void> {
  const ffmpeg = require('ffmpeg-static') as string;
  const inputs = paths.map((p) => `-i "${p}"`).join(' ');
  const n = paths.length;
  const chains = paths.map((_, i) => `[${i}:v][${i}:a]`).join('');
  await execAsync([
    `"${ffmpeg}" -y -loglevel error`, inputs,
    `-filter_complex "${chains}concat=n=${n}:v=1:a=1[outv][outa]"`,
    `-map "[outv]" -map "[outa]" -r 30`,
    `-c:v libx264 -pix_fmt yuv420p -preset ultrafast -threads 1 -g 60`,
    `-c:a aac -ar 44100 -movflags +faststart`, `"${outPath}"`,
  ].join(' '), { maxBuffer: 1024 * 1024 * 64 });
}

/** 파일 길이(초) — ffmpeg-static 엔 ffprobe 가 없어 `ffmpeg -i` stderr 의 Duration 파싱 */
/**
 * 캐릭터 이미지를 9:16(720x1280)로 정규화. **머리(위) 고정 cover-crop**:
 * 가로폭을 채우고, 세로가 넘치면 위(y=0=머리)는 두고 아래만 잘라 채운다(가로는 중앙 크롭).
 * Kling이 입력 비율을 따라가므로 9:16로 맞춰 보내면 출력도 9:16 → 합성 잘림/크래시 방지.
 * 정상 9:16 프리셋(720x1280)엔 사실상 no-op.
 */
export async function fitCharTo916(srcPath: string, outPath: string): Promise<void> {
  const ffmpeg = require('ffmpeg-static') as string;
  await execAsync(
    `"${ffmpeg}" -y -loglevel error -i "${srcPath}" ` +
    `-vf "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280:(iw-ow)/2:0,setsar=1" ` +
    `-frames:v 1 "${outPath}"`
  );
}

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
