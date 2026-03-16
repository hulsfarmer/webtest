import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { VideoScript } from './anthropic';
import { fetchPexelsVideoUrl, downloadVideo, getPexelsKeyword } from './pexels';

const execAsync = promisify(exec);

// Korean topic → gradient palette keyword mapping
const KO_EN: Array<[string, string]> = [
  // 동물
  ['강아지', 'pet'],
  ['고양이', 'pet'],
  ['반려동물', 'pet'],
  ['동물', 'pet'],
  ['새', 'lifestyle'],
  // 음식/건강
  ['다이어트', 'diet'],
  ['건강', 'health'],
  ['요리', 'food'],
  ['음식', 'food'],
  ['커피', 'lifestyle'],
  // 돈/비즈니스
  ['재테크', 'finance'],
  ['투자', 'investing'],
  ['돈', 'money'],
  ['취업', 'career'],
  ['창업', 'startup'],
  ['부동산', 'estate'],
  ['주식', 'stock'],
  // 라이프스타일
  ['여행', 'travel'],
  ['운동', 'workout'],
  ['공부', 'study'],
  ['영어', 'english'],
  ['독서', 'reading'],
  ['마음', 'meditation'],
  ['행복', 'lifestyle'],
  ['자기계발', 'success'],
  ['성공', 'success'],
  ['관계', 'people'],
  ['심리', 'psychology'],
  ['육아', 'parenting'],
  // 뷰티/패션
  ['패션', 'fashion'],
  ['뷰티', 'beauty'],
  // 기술/문화
  ['과학', 'lifestyle'],
  ['음악', 'lifestyle'],
  ['스포츠', 'workout'],
];

function extractKeywords(text: string): string {
  const sorted = [...KO_EN].sort((a, b) => b[0].length - a[0].length);
  for (const [ko, en] of sorted) {
    if (text.includes(ko)) return en;
  }
  return 'lifestyle';
}

// Find a Korean-capable font
function findFont(): string {
  const candidates = [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    path.join(process.cwd(), 'public/fonts/NotoSansKR-Regular.ttf'),
    '/Library/Fonts/AppleSDGothicNeo.ttc',
    '/System/Library/Fonts/AppleSDGothicNeo.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/nanum/NanumGothic.ttf',
  ];
  for (const f of candidates) {
    if (fs.existsSync(f)) return f;
  }
  return '';
}

async function getAudioDuration(audioPath: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpegPath = require('ffmpeg-static') as string;
  try {
    const result = await execAsync(`"${ffmpegPath}" -i "${audioPath}"`).catch((e) => e);
    const text = (result?.stderr ?? '') + (result?.stdout ?? '');
    const m = text.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    if (m) return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
  } catch {
    // ignore
  }
  return 60;
}

function splitIntoSentences(text: string): string[] {
  // Only split at sentence-ending punctuation — never mid-sentence.
  // Splitting at commas or arbitrary char limits causes perceived audio pauses
  // because TTS continues speaking while the subtitle frame changes.
  const parts = text
    .split(/(?<=[.!?。！？])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [text];
}

function wrapKorean(text: string, maxChars = 14): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current === '') {
      if (word.length > maxChars) {
        let rem = word;
        while (rem.length > maxChars) {
          lines.push(rem.slice(0, maxChars));
          rem = rem.slice(maxChars);
        }
        current = rem;
      } else {
        current = word;
      }
    } else if ((current + ' ' + word).length <= maxChars) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word.length > maxChars ? (() => {
        let rem = word;
        while (rem.length > maxChars) { lines.push(rem.slice(0, maxChars)); rem = rem.slice(maxChars); }
        return rem;
      })() : word;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}

// ── Fixed layout constants — Safe Zone 기반 (shared by both overlay functions) ──
// 쇼츠 Safe Zone: 상단 15% (288px), 하단 25% (480px) 확보
const H_FULL = 1920;
const SAFE_TOP = Math.round(H_FULL * 0.15);     // 288px — 상단 UI 영역
const SAFE_BOTTOM = Math.round(H_FULL * 0.25);  // 480px — 하단 UI 영역
const TITLE_ZONE_Y = SAFE_TOP;                   // 288px부터 시작
const TITLE_ZONE_H = 340;                        // 업체명 + 여백 + 캐치프레이즈
const DIV_Y = TITLE_ZONE_Y + TITLE_ZONE_H + 16;
const BOX_W_MARGIN = 40;
const INFO_H = 84;
const INFO_BOTTOM_MARGIN = 60;
// Lower Third: 하단 Safe Zone 위에 배치
const BOX_H = 380;
const BOX_Y = H_FULL - SAFE_BOTTOM - BOX_H + 60; // Safe Zone 바로 위

// ── Text overlay PNG (transparent background) for Pexels video mode ──
async function createTextOverlay(
  title: string,
  text: string,
  sectionType: string,
  frameIndex: number,
  totalFrames: number,
  outputPath: string,
  bottomInfo?: string,
  displayBusinessName?: string,
  showWatermark?: boolean,
): Promise<void> {
  const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas');

  const fontPath = findFont();
  let fontFamily = 'sans-serif';
  if (fontPath) {
    try {
      GlobalFonts.registerFromPath(fontPath, 'KoreanFont');
      fontFamily = 'KoreanFont, sans-serif';
    } catch { /* use system fonts */ }
  }

  const W = 1080;
  const H = 1920;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Fully transparent background
  ctx.clearRect(0, 0, W, H);

  const badgeColors: Record<string, string> = {
    hook: '#A855F7',
    main: '#3B82F6',
    cta: '#EC4899',
  };
  const accentColor = badgeColors[sectionType] || '#A855F7';

  // Top accent bar
  const topGrad = ctx.createLinearGradient(0, 0, W, 0);
  topGrad.addColorStop(0, 'transparent');
  topGrad.addColorStop(0.3, accentColor + 'CC');
  topGrad.addColorStop(0.7, accentColor + 'CC');
  topGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, W, 8);

  // 모든 텍스트 중앙 정렬
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Brand watermark (무료 플랜만)
  if (showWatermark) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = `bold 34px ${fontFamily}`;
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 12;
    ctx.fillText('ShortsAI', W / 2, 76);
  }
  ctx.shadowBlur = 0;

  // ── TITLE ZONE: optional business name (top, small) + catchy title (below, large) ──
  if (displayBusinessName || title) {
    if (displayBusinessName) {
      // Row 1 — business name: 66px, golden yellow, clean (no shadow)
      ctx.font = `bold 66px ${fontFamily}`;
      ctx.fillStyle = '#FBBF24';
      ctx.fillText(displayBusinessName, W / 2, TITLE_ZONE_Y + 58);
      // Thin separator glow under business name
      const sepGrad = ctx.createLinearGradient(200, 0, W - 200, 0);
      sepGrad.addColorStop(0, 'transparent');
      sepGrad.addColorStop(0.5, accentColor + '55');
      sepGrad.addColorStop(1, 'transparent');
      ctx.strokeStyle = sepGrad;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(200, TITLE_ZONE_Y + 90);
      ctx.lineTo(W - 200, TITLE_ZONE_Y + 90);
      ctx.stroke();
    }

    if (title) {
      // Row 2 — catchy title: gradient bold text
      // When businessName is also shown, use the lower portion of the title zone
      const catchyZoneTop = displayBusinessName ? TITLE_ZONE_Y + 110 : TITLE_ZONE_Y;
      const catchyZoneH   = displayBusinessName ? TITLE_ZONE_H - 110 : TITLE_ZONE_H;
      const titleFontSize = displayBusinessName ? 66 : 78;
      const titleWrapped  = wrapKorean(title, 13);
      const titleLines    = titleWrapped.split('\n');
      const titleLineH    = titleFontSize + 14;
      const titleBlockH   = titleLines.length * titleLineH;
      const titleStartY   = catchyZoneTop + (catchyZoneH - titleBlockH) / 2 + titleFontSize * 0.85;

      ctx.font = `bold ${titleFontSize}px ${fontFamily}`;
      const titleGrad = ctx.createLinearGradient(W / 2 - 380, 0, W / 2 + 380, 0);
      titleGrad.addColorStop(0, 'white');
      titleGrad.addColorStop(1, accentColor);
      ctx.fillStyle = titleGrad;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(0,0,0,1)';
      ctx.shadowBlur = 28;
      titleLines.forEach((line, i) => {
        ctx.strokeText(line, W / 2, titleStartY + i * titleLineH);
        ctx.fillText(line, W / 2, titleStartY + i * titleLineH);
      });
      ctx.shadowBlur = 0;
    }

  }

  // ── MAIN TEXT BOX (Lower Third): 반투명 그라데이션 배경 ──
  const effectiveBOX_Y = BOX_Y;
  const effectiveBOX_H = BOX_H;
  const boxX = 0;
  const boxW = W;
  // 하단 그라데이션 오버레이 (위: 투명 → 아래: 반투명 검정)
  const boxGrad = ctx.createLinearGradient(0, effectiveBOX_Y - 60, 0, effectiveBOX_Y + effectiveBOX_H);
  boxGrad.addColorStop(0, 'rgba(0,0,0,0)');
  boxGrad.addColorStop(0.15, 'rgba(0,0,0,0.3)');
  boxGrad.addColorStop(0.5, 'rgba(0,0,0,0.55)');
  boxGrad.addColorStop(1, 'rgba(0,0,0,0.7)');
  ctx.fillStyle = boxGrad;
  ctx.fillRect(boxX, effectiveBOX_Y - 60, boxW, effectiveBOX_H + 60);

  // Text centered vertically within the fixed box — fixed font size for consistency
  const wrapped = wrapKorean(text, 14);
  const textLines = wrapped.split('\n');
  const fontSize = 62;
  const lineHeight = fontSize + 18;
  const textBlockH = textLines.length * lineHeight;
  const textStartY = effectiveBOX_Y + (effectiveBOX_H - textBlockH) / 2 + fontSize * 0.85;

  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = 'white';
  ctx.shadowColor = 'rgba(0,0,0,0.95)';
  ctx.shadowBlur = 18;
  textLines.forEach((line, i) => {
    ctx.fillText(line, W / 2, textStartY + i * lineHeight);
  });
  ctx.shadowBlur = 0;

  // ── BOTTOM INFO BAR: 본문 박스 바로 아래 ──
  if (bottomInfo) {
    const infoY = effectiveBOX_Y + effectiveBOX_H + 10;
    const lineGrad = ctx.createLinearGradient(120, 0, W - 120, 0);
    lineGrad.addColorStop(0, 'transparent');
    lineGrad.addColorStop(0.3, accentColor + 'BB');
    lineGrad.addColorStop(0.7, accentColor + 'BB');
    lineGrad.addColorStop(1, 'transparent');
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(120, infoY);
    ctx.lineTo(W - 120, infoY);
    ctx.stroke();
    ctx.font = `bold 26px ${fontFamily}`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.shadowColor = 'rgba(0,0,0,1)';
    ctx.shadowBlur = 12;
    ctx.fillText(bottomInfo, W / 2, infoY + 40);
    ctx.shadowBlur = 0;
  }

  // Progress bar (Safe Zone 하단 경계에 배치)
  const barH = 10;
  const barY = H_FULL - SAFE_BOTTOM + 20;
  const barPad = 60;
  const barW = W - barPad * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.roundRect(barPad - 8, barY - 8, barW + 16, barH + 16, 8);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath();
  ctx.roundRect(barPad, barY, barW, barH, 5);
  ctx.fill();
  const progress = totalFrames > 1 ? frameIndex / (totalFrames - 1) : 1;
  const fillW = Math.max(barW * progress, barH);
  const fillGrad = ctx.createLinearGradient(barPad, 0, barPad + barW, 0);
  fillGrad.addColorStop(0, accentColor);
  fillGrad.addColorStop(1, '#EC4899');
  ctx.fillStyle = fillGrad;
  ctx.beginPath();
  ctx.roundRect(barPad, barY, fillW, barH, 5);
  ctx.fill();

  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outputPath, buffer);
}

// ── Static gradient frame (fallback when no Pexels) ──
async function createFrameImage(
  title: string,
  text: string,
  sectionType: string,
  frameIndex: number,
  totalFrames: number,
  outputPath: string,
  bgKeyword: string = 'lifestyle',
  bottomInfo?: string,
  displayBusinessName?: string,
  showWatermark?: boolean,
): Promise<void> {
  const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas');

  const fontPath = findFont();
  let fontFamily = 'sans-serif';
  if (fontPath) {
    try {
      GlobalFonts.registerFromPath(fontPath, 'KoreanFont');
      fontFamily = 'KoreanFont, sans-serif';
    } catch { /* use system fonts */ }
  }

  const W = 1080;
  const H = 1920;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  type GradPalette = [string, string, string];
  const palettes: Record<string, GradPalette> = {
    diet:       ['#1a4731', '#0d2d1e', '#061409'],
    health:     ['#0f3443', '#1a6b6b', '#0a2233'],
    finance:    ['#1a2744', '#0d1e66', '#060d33'],
    money:      ['#1a2744', '#0d1e66', '#060d33'],
    investing:  ['#1a2744', '#0d1e66', '#060d33'],
    english:    ['#1a1a4b', '#2d0d4b', '#0d0a1e'],
    food:       ['#4b1a0d', '#2d0d06', '#1e0a06'],
    travel:     ['#0d2b4b', '#1a3d6b', '#060f1e'],
    workout:    ['#2b1a4b', '#1a0d66', '#0d0633'],
    study:      ['#1a2b1a', '#0d1e0d', '#060d06'],
    career:     ['#1a1a3d', '#0d0d2d', '#060614'],
    startup:    ['#3d1a0d', '#2d0d06', '#1e0906'],
    estate:     ['#1a3d1a', '#0d2d0d', '#061406'],
    stock:      ['#0d2b4b', '#0d1e3d', '#060d1e'],
    reading:    ['#2b1a0d', '#1e0d06', '#0d0906'],
    meditation: ['#1a0b35', '#2d1a4b', '#0d0a1e'],
    people:     ['#4b0d2b', '#33061e', '#1e0612'],
    psychology: ['#2b0d4b', '#1a0633', '#0d031a'],
    fashion:    ['#3d0d2b', '#2d061e', '#1e0312'],
    beauty:     ['#4b0d35', '#33061e', '#1e030f'],
    parenting:  ['#1a3d2b', '#0d2d1e', '#06140d'],
    pet:        ['#2b3d1a', '#1e4b0d', '#0d2506'],
    success:    ['#3d2b0d', '#2d1e06', '#1e1403'],
    lifestyle:  ['#1a0b35', '#0d1b4b', '#0b0a14'],
  };

  const pal: GradPalette = palettes[bgKeyword] ?? ['#1a0b35', '#0d1b4b', '#0b0a14'];
  const bgGrad = ctx.createLinearGradient(0, 0, W * 0.4, H);
  bgGrad.addColorStop(0, pal[0]);
  bgGrad.addColorStop(0.5, pal[1]);
  bgGrad.addColorStop(1, pal[2]);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  const streakGrad = ctx.createLinearGradient(0, 0, W, H * 0.6);
  streakGrad.addColorStop(0, 'rgba(255,255,255,0)');
  streakGrad.addColorStop(0.45, 'rgba(255,255,255,0.04)');
  streakGrad.addColorStop(0.5, 'rgba(255,255,255,0.08)');
  streakGrad.addColorStop(0.55, 'rgba(255,255,255,0.04)');
  streakGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = streakGrad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(0, 0, W, H);

  const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.9);
  vignette.addColorStop(0, 'transparent');
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  const badgeColors: Record<string, string> = {
    hook: '#A855F7', main: '#3B82F6', cta: '#EC4899',
  };
  const accentColor = badgeColors[sectionType] || '#A855F7';

  // Top accent bar
  const topGrad = ctx.createLinearGradient(0, 0, W, 0);
  topGrad.addColorStop(0, 'transparent');
  topGrad.addColorStop(0.3, accentColor);
  topGrad.addColorStop(0.7, accentColor);
  topGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, W, 8);

  // 모든 텍스트 중앙 정렬
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Brand watermark (무료 플랜만)
  if (showWatermark) {
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font = `bold 34px ${fontFamily}`;
    ctx.fillText('ShortsAI', W / 2, 76);
  }

  // ── TITLE ZONE: optional business name (top, small) + catchy title (below, large) ──
  if (displayBusinessName || title) {
    if (displayBusinessName) {
      // Row 1 — business name: 66px, golden yellow, clean (no shadow)
      ctx.font = `bold 66px ${fontFamily}`;
      ctx.fillStyle = '#FBBF24';
      ctx.fillText(displayBusinessName, W / 2, TITLE_ZONE_Y + 58);
      // Thin separator glow under business name
      const sepGrad = ctx.createLinearGradient(200, 0, W - 200, 0);
      sepGrad.addColorStop(0, 'transparent');
      sepGrad.addColorStop(0.5, accentColor + '55');
      sepGrad.addColorStop(1, 'transparent');
      ctx.strokeStyle = sepGrad;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(200, TITLE_ZONE_Y + 72);
      ctx.lineTo(W - 200, TITLE_ZONE_Y + 72);
      ctx.stroke();
    }

    if (title) {
      // Row 2 — catchy title: gradient bold text
      const catchyZoneTop = displayBusinessName ? TITLE_ZONE_Y + 82 : TITLE_ZONE_Y;
      const catchyZoneH   = displayBusinessName ? TITLE_ZONE_H - 110 : TITLE_ZONE_H;
      const titleFontSize = displayBusinessName ? 66 : 78;
      const titleWrapped  = wrapKorean(title, 13);
      const titleLines    = titleWrapped.split('\n');
      const titleLineH    = titleFontSize + 14;
      const titleBlockH   = titleLines.length * titleLineH;
      const titleStartY   = catchyZoneTop + (catchyZoneH - titleBlockH) / 2 + titleFontSize * 0.85;

      ctx.font = `bold ${titleFontSize}px ${fontFamily}`;
      const titleGrad = ctx.createLinearGradient(W / 2 - 380, 0, W / 2 + 380, 0);
      titleGrad.addColorStop(0, 'white');
      titleGrad.addColorStop(1, accentColor);
      ctx.fillStyle = titleGrad;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(0,0,0,1)';
      ctx.shadowBlur = 28;
      titleLines.forEach((line, i) => {
        ctx.strokeText(line, W / 2, titleStartY + i * titleLineH);
        ctx.fillText(line, W / 2, titleStartY + i * titleLineH);
      });
      ctx.shadowBlur = 0;
    }

  }

  // ── MAIN TEXT BOX (Lower Third): 반투명 그라데이션 배경 ──
  const effectiveBOX_Y = BOX_Y;
  const effectiveBOX_H = BOX_H;
  const boxX = 0;
  const boxW = W;
  const boxGrad = ctx.createLinearGradient(0, effectiveBOX_Y - 60, 0, effectiveBOX_Y + effectiveBOX_H);
  boxGrad.addColorStop(0, 'rgba(0,0,0,0)');
  boxGrad.addColorStop(0.15, 'rgba(0,0,0,0.3)');
  boxGrad.addColorStop(0.5, 'rgba(0,0,0,0.55)');
  boxGrad.addColorStop(1, 'rgba(0,0,0,0.7)');
  ctx.fillStyle = boxGrad;
  ctx.fillRect(boxX, effectiveBOX_Y - 60, boxW, effectiveBOX_H + 60);

  // Fixed font size for consistency across all frames
  const wrapped = wrapKorean(text, 14);
  const textLines = wrapped.split('\n');
  const fontSize = 62;
  const lineHeight = fontSize + 18;
  const textBlockH = textLines.length * lineHeight;
  const textStartY = effectiveBOX_Y + (effectiveBOX_H - textBlockH) / 2 + fontSize * 0.85;

  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = 'white';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 16;
  textLines.forEach((line, i) => {
    ctx.fillText(line, W / 2, textStartY + i * lineHeight);
  });
  ctx.shadowBlur = 0;

  // ── BOTTOM INFO BAR: 본문 박스 바로 아래 ──
  if (bottomInfo) {
    const infoY = effectiveBOX_Y + effectiveBOX_H + 10;
    const lineGrad = ctx.createLinearGradient(120, 0, W - 120, 0);
    lineGrad.addColorStop(0, 'transparent');
    lineGrad.addColorStop(0.3, accentColor + 'BB');
    lineGrad.addColorStop(0.7, accentColor + 'BB');
    lineGrad.addColorStop(1, 'transparent');
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(120, infoY);
    ctx.lineTo(W - 120, infoY);
    ctx.stroke();
    ctx.font = `bold 26px ${fontFamily}`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.shadowColor = 'rgba(0,0,0,1)';
    ctx.shadowBlur = 12;
    ctx.fillText(bottomInfo, W / 2, infoY + 40);
    ctx.shadowBlur = 0;
  }

  // Progress bar (Safe Zone 하단 경계에 배치)
  const barH = 8;
  const barY = H_FULL - SAFE_BOTTOM + 20;
  const barPad = 60;
  const barW = W - barPad * 2;
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.roundRect(barPad, barY, barW, barH, 4);
  ctx.fill();
  const progress = totalFrames > 1 ? frameIndex / (totalFrames - 1) : 1;
  const fillW = Math.max(barW * progress, barH);
  const fillGrad = ctx.createLinearGradient(barPad, 0, barPad + barW, 0);
  fillGrad.addColorStop(0, accentColor);
  fillGrad.addColorStop(1, '#EC4899');
  ctx.fillStyle = fillGrad;
  ctx.beginPath();
  ctx.roundRect(barPad, barY, fillW, barH, 4);
  ctx.fill();

  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outputPath, buffer);
}

// ── Mode 3: Create slideshow video from user-uploaded images ──────────────────
async function createImageSlideshowVideo(
  imagePaths: string[],
  totalDuration: number,
  outputPath: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpegPath = require('ffmpeg-static') as string;

  const perImageDuration = totalDuration / imagePaths.length;

  // Build inputs: each image looped for its duration
  const inputs = imagePaths.map(p =>
    `-loop 1 -t ${perImageDuration.toFixed(3)} -i "${p}"`
  ).join(' ');

  // Scale/crop each image to 1080×1920, then concat all
  const scaleFilters = imagePaths.map((_, i) =>
    `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
    `crop=1080:1920:(iw-1080)/2:(ih-1920)/2,setsar=1,fps=30[v${i}]`
  );
  const concatInputLabels = imagePaths.map((_, i) => `[v${i}]`).join('');
  const filterComplex = [
    ...scaleFilters,
    `${concatInputLabels}concat=n=${imagePaths.length}:v=1[out]`,
  ].join(';');

  const cmd = [
    `"${ffmpegPath}"`,
    inputs,
    `-filter_complex "${filterComplex}"`,
    `-map "[out]"`,
    `-c:v libx264 -preset ultrafast -crf 26`,
    `-pix_fmt yuv420p`,
    `-t ${totalDuration.toFixed(3)}`,
    `-y "${outputPath}"`,
  ].join(' ');

  await execAsync(cmd, { maxBuffer: 1024 * 1024 * 100 });
}

export async function generateVideo(
  script: VideoScript,
  audioPath: string,
  outputPath: string,
  userImagePaths?: string[],
  bottomInfo?: string,
  externalSentenceDurations?: number[],
  displayBusinessName?: string,
  bgmPath?: string,
  bgmId?: string,
  externalBgmVolume?: number,
  showWatermark?: boolean,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpegPath = require('ffmpeg-static') as string;

  // BGM volume: use user-specified value, or auto (calm/trendy louder, others softer)
  const bgmVolume = externalBgmVolume !== undefined
    ? externalBgmVolume.toFixed(2)
    : (bgmId === 'calm' || bgmId === 'trendy') ? '0.45'
    : (bgmId === 'professional' || bgmId === 'energetic') ? '0.10' : '0.20';

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const tmpDir = path.join(outputDir, 'tmp_' + path.basename(outputPath, '.mp4'));
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const audioDuration = await getAudioDuration(audioPath);

  // ── 마무리 효과음(딩) 생성 후 나레이션 오디오 끝에 합성 ──
  const chimeFile = path.join(tmpDir, 'chime.wav');
  const narrationWithChime = path.join(tmpDir, 'narration_chime.mp3');
  try {
    // 부드러운 2-tone 차임: C6(1047Hz) 0.15s → E6(1319Hz) 0.25s, 볼륨 fade
    await execAsync(
      `"${ffmpegPath}" -f lavfi -i "sine=frequency=1047:duration=0.15:sample_rate=44100" ` +
      `-f lavfi -i "sine=frequency=1319:duration=0.25:sample_rate=44100" ` +
      `-filter_complex "[0:a]afade=t=out:st=0.1:d=0.05[a0];[1:a]adelay=150|150,afade=t=out:st=0.15:d=0.1[a1];` +
      `[a0][a1]amix=inputs=2:duration=longest,volume=0.5[chime]" ` +
      `-map "[chime]" -y "${chimeFile}"`
    );
    // 나레이션 끝에 0.3초 간격 후 효과음 추가
    const chimeDelay = Math.round((audioDuration + 0.3) * 1000); // ms
    await execAsync(
      `"${ffmpegPath}" -i "${audioPath}" -i "${chimeFile}" ` +
      `-filter_complex "[1:a]adelay=${chimeDelay}|${chimeDelay}[chime_d];` +
      `[0:a][chime_d]amix=inputs=2:duration=longest[aout]" ` +
      `-map "[aout]" -c:a libmp3lame -q:a 3 -y "${narrationWithChime}"`
    );
    // 이후 audioPath 대신 narrationWithChime 사용
    // (audioPath는 원본 유지 — 나중에 정리)
    console.log('[Video] Chime appended to narration');
  } catch (e) {
    console.warn('[Video] Chime generation failed, continuing without:', e);
  }
  // 효과음이 합성된 오디오 경로 (실패 시 원본 사용)
  const finalAudioPath = fs.existsSync(narrationWithChime) ? narrationWithChime : audioPath;

  const sections = script.sections;
  // Claude가 생성한 bgKeyword 우선 사용, 없으면 하드코딩 매핑 fallback
  const fullScriptText = script.title + ' ' + script.sections.map(s => s.text).join(' ');
  const keyword = extractKeywords(fullScriptText);
  const pexelsKeyword = script.bgKeyword?.trim() || getPexelsKeyword(fullScriptText);
  console.log(`[Video] Pexels keyword: "${pexelsKeyword}" (bgKeyword: "${script.bgKeyword}")`);

  // ── Mode 3: User-uploaded images as slideshow background (highest priority) ──
  let videoPath: string | null = null;
  const validUserImages = (userImagePaths ?? []).filter(p => fs.existsSync(p));
  if (validUserImages.length > 0) {
    try {
      console.log(`[Video] Mode: user image slideshow (${validUserImages.length} images)`);
      const slideshowPath = path.join(tmpDir, 'slideshow_bg.mp4');
      await createImageSlideshowVideo(validUserImages, audioDuration + 2, slideshowPath);
      videoPath = slideshowPath;
      console.log('[Video] Slideshow video ready');
    } catch (e) {
      console.warn('[Video] Slideshow creation failed, trying Pexels:', e);
    }
  }

  // ── Try to get Pexels video background (if no user images) ──
  const pexelsKey = process.env.PEXELS_API_KEY;
  if (!videoPath && pexelsKey) {
    try {
      console.log(`[Video] Fetching Pexels video: "${pexelsKeyword}"`);
      const videoUrl = await fetchPexelsVideoUrl(pexelsKeyword, pexelsKey);
      if (videoUrl) {
        const rawPath = path.join(tmpDir, 'bg_raw.mp4');
        console.log('[Video] Downloading Pexels video...');
        await downloadVideo(videoUrl, rawPath);
        videoPath = rawPath;
        console.log('[Video] Pexels video ready');
      }
    } catch (e) {
      console.warn('[Video] Pexels failed, using gradient:', e);
    }
  }

  // Build sentence list
  type SentenceItem = { sentence: string; sectionType: string };
  const allSentences: SentenceItem[] = [];
  for (let i = 0; i < sections.length; i++) {
    for (const sentence of splitIntoSentences(sections[i].text)) {
      allSentences.push({ sentence, sectionType: sections[i].type });
    }
  }
  const totalChars = allSentences.reduce((s, item) => s + item.sentence.length, 0);

  // Sentence durations: use externally-supplied SSML timepoints when available,
  // otherwise fall back to proportional character-count estimation.
  const sentenceDurations: number[] = externalSentenceDurations && externalSentenceDurations.length === allSentences.length
    ? externalSentenceDurations
    : allSentences.map(item =>
        Math.max((item.sentence.length / totalChars) * audioDuration, 0.4)
      );
  const sentenceTimestamps: number[] = [];
  let cumTime = 0;
  for (const dur of sentenceDurations) {
    sentenceTimestamps.push(cumTime);
    cumTime += dur;
  }

  if (videoPath) {
    // ════════════════════════════════════════════════════════
    // MODE 1: Pexels video plays continuously, text overlaid
    // ════════════════════════════════════════════════════════
    console.log('[Video] Mode: Pexels video overlay');

    // Generate transparent text overlay PNGs
    const overlayPaths: string[] = [];
    for (let idx = 0; idx < allSentences.length; idx++) {
      const { sentence, sectionType } = allSentences[idx];
      const overlayPath = path.join(tmpDir, `overlay_${idx}.png`);
      await createTextOverlay(
        script.title, sentence, sectionType,
        idx, allSentences.length, overlayPath,
        bottomInfo, displayBusinessName, showWatermark,
      );
      overlayPaths.push(overlayPath);
    }

    // Build FFmpeg inputs:
    // [0] = bg video (looped), [1..N] = overlay PNGs, [N+1] = audio, [N+2] = BGM (optional)
    const bgLoopDuration = (audioDuration + 1.5 + 1).toFixed(3); // audioDuration + fadeOut + buffer
    const bgmInputArg = bgmPath
      ? `-stream_loop -1 -t ${bgLoopDuration} -i "${bgmPath}"`
      : '';
    const inputArgs = [
      `-stream_loop -1 -t ${bgLoopDuration} -i "${videoPath}"`,
      ...overlayPaths.map(p => `-i "${p}"`),
      `-i "${finalAudioPath}"`,
      ...(bgmPath ? [bgmInputArg] : []),
    ].join(' ');

    // Build filter_complex:
    // Scale bg → chain overlay each text PNG with enable='between(t, start, end)'
    const filterParts: string[] = [];
    filterParts.push(
      `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
      `crop=1080:1920:(iw-1080)/2:(ih-1920)/2,setsar=1[bg0]`
    );

    // Use between(t, start, end) so only ONE overlay is active at a time.
    // End time = next segment's start time → gap-free transitions.
    // (Fixed-size box ensures no trembling at transitions.)
    let prevLabel = 'bg0';
    for (let i = 0; i < overlayPaths.length; i++) {
      const tStart = sentenceTimestamps[i].toFixed(3);
      const tEnd = i < overlayPaths.length - 1
        ? sentenceTimestamps[i + 1].toFixed(3)
        : (audioDuration + 2).toFixed(3);
      const outLabel = i === overlayPaths.length - 1 ? 'vout' : `v${i + 1}`;
      filterParts.push(
        `[${prevLabel}][${i + 1}:v]overlay=0:0:enable='between(t,${tStart},${tEnd})'[${outLabel}]`
      );
      prevLabel = outLabel;
    }

    const audioInputIdx = overlayPaths.length + 1;
    const bgmInputIdx   = overlayPaths.length + 2;

    // 페이드아웃: 영상 끝 1.5초 + BGM 여운 1.5초
    const fadeOutDur = 1.5;
    const totalDur = audioDuration + fadeOutDur;
    const fadeStart = totalDur - fadeOutDur;

    // 비디오 페이드아웃 추가 (vout → vfaded)
    filterParts.push(
      `[vout]fade=t=out:st=${fadeStart.toFixed(3)}:d=${fadeOutDur.toFixed(3)}[vfaded]`
    );

    // BGM audio mixing + BGM 여운 페이드아웃
    if (bgmPath) {
      filterParts.push(
        `[${bgmInputIdx}:a]volume=${bgmVolume},afade=t=out:st=${fadeStart.toFixed(3)}:d=${fadeOutDur.toFixed(3)}[bgm_adj]`,
        `[${audioInputIdx}:a][bgm_adj]amix=inputs=2:duration=longest:dropout_transition=2[aout]`
      );
    } else {
      // BGM 없으면 나레이션에도 페이드아웃
      filterParts.push(
        `[${audioInputIdx}:a]afade=t=out:st=${fadeStart.toFixed(3)}:d=${fadeOutDur.toFixed(3)}[aout]`
      );
    }

    const filterGraph = filterParts.join(';');

    const cmd = [
      `"${ffmpegPath}"`,
      inputArgs,
      `-filter_complex "${filterGraph}"`,
      `-map "[vfaded]"`,
      `-map "[aout]"`,
      `-c:v libx264 -preset ultrafast -crf 26`,
      `-c:a aac -b:a 128k`,
      `-pix_fmt yuv420p`,
      `-movflags +faststart`,
      `-t ${totalDur.toFixed(3)}`,
      `-y "${outputPath}"`,
    ].join(' ');

    console.log('[Video] Running FFmpeg overlay command...');
    await execAsync(cmd, { maxBuffer: 1024 * 1024 * 100 });

    // Cleanup
    try {
      overlayPaths.forEach(p => fs.existsSync(p) && fs.unlinkSync(p));
      fs.existsSync(videoPath) && fs.unlinkSync(videoPath);
      fs.rmdirSync(tmpDir, { recursive: true });
    } catch { /* ignore */ }

  } else {
    // ════════════════════════════════════════
    // MODE 2: Gradient background (no Pexels)
    // ════════════════════════════════════════
    console.log('[Video] Mode: gradient background');

    const framePaths: Array<{ path: string; duration: number }> = [];
    for (let idx = 0; idx < allSentences.length; idx++) {
      const { sentence, sectionType } = allSentences[idx];
      const framePath = path.join(tmpDir, `frame_${idx}.png`);
      await createFrameImage(
        script.title, sentence, sectionType,
        idx, allSentences.length, framePath, keyword,
        bottomInfo, displayBusinessName, showWatermark,
      );
      framePaths.push({ path: framePath, duration: sentenceDurations[idx] });
    }

    // FFmpeg concat file
    const concatFile = path.join(tmpDir, 'concat.txt');
    const concatContent = framePaths
      .map((f) => `file '${f.path.replace(/'/g, "'\\''")}'\nduration ${f.duration.toFixed(3)}`)
      .join('\n');
    const lastFrame = framePaths[framePaths.length - 1];
    fs.writeFileSync(
      concatFile,
      concatContent + `\nfile '${lastFrame.path.replace(/'/g, "'\\''")}'\n`
    );

    // Mode 2: BGM mixing + 페이드아웃
    const m2FadeOutDur = 1.5;
    const m2TotalDur = audioDuration + m2FadeOutDur;
    const m2FadeStart = m2TotalDur - m2FadeOutDur;
    let cmd: string;
    if (bgmPath) {
      // [0]=concat frames [1]=narration [2]=BGM (looped)
      const bgmLoopDur = (m2TotalDur + 1).toFixed(3);
      const m2filter = [
        `[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,` +
        `pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,` +
        `fade=t=out:st=${m2FadeStart.toFixed(3)}:d=${m2FadeOutDur.toFixed(3)}[vout]`,
        `[2:a]volume=${bgmVolume},afade=t=out:st=${m2FadeStart.toFixed(3)}:d=${m2FadeOutDur.toFixed(3)}[bgm_adj]`,
        `[1:a][bgm_adj]amix=inputs=2:duration=longest:dropout_transition=2[aout]`,
      ].join(';');
      cmd = [
        `"${ffmpegPath}"`,
        `-f concat -safe 0 -i "${concatFile}"`,
        `-i "${finalAudioPath}"`,
        `-stream_loop -1 -t ${bgmLoopDur} -i "${bgmPath}"`,
        `-filter_complex "${m2filter}"`,
        `-map "[vout]"`,
        `-map "[aout]"`,
        `-c:v libx264 -preset ultrafast -crf 26`,
        `-c:a aac -b:a 128k`,
        `-pix_fmt yuv420p`,
        `-movflags +faststart`,
        `-t ${m2TotalDur.toFixed(3)}`,
        `-y "${outputPath}"`,
      ].join(' ');
    } else {
      const m2filterNoB = [
        `[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,` +
        `pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,` +
        `fade=t=out:st=${m2FadeStart.toFixed(3)}:d=${m2FadeOutDur.toFixed(3)}[vout]`,
        `[1:a]afade=t=out:st=${m2FadeStart.toFixed(3)}:d=${m2FadeOutDur.toFixed(3)}[aout]`,
      ].join(';');
      cmd = [
        `"${ffmpegPath}"`,
        `-f concat -safe 0 -i "${concatFile}"`,
        `-i "${finalAudioPath}"`,
        `-filter_complex "${m2filterNoB}"`,
        `-map "[vout]"`,
        `-map "[aout]"`,
        `-c:v libx264 -preset ultrafast -crf 26`,
        `-c:a aac -b:a 128k`,
        `-pix_fmt yuv420p`,
        `-movflags +faststart`,
        `-t ${m2TotalDur.toFixed(3)}`,
        `-y "${outputPath}"`,
      ].join(' ');
    }

    await execAsync(cmd, { maxBuffer: 1024 * 1024 * 50 });

    // Cleanup
    try {
      framePaths.forEach((f) => fs.existsSync(f.path) && fs.unlinkSync(f.path));
      fs.existsSync(concatFile) && fs.unlinkSync(concatFile);
      fs.rmdirSync(tmpDir, { recursive: true });
    } catch { /* ignore */ }
  }
}
