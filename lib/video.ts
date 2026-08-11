import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { VideoScript } from './anthropic';
import { fetchPexelsVideoUrl, downloadVideo, getPexelsKeyword } from './pexels';

const execAsync = promisify(exec);

// Strip phone numbers/URLs from text (same logic as promo route)
// so that sentence splitting matches TTS input exactly.
function stripContactFromText(text: string): string {
  return text
    .replace(/\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/g, '')
    .replace(/\b0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}\b/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

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

// 컬러 이모지 폰트 (자막 이모지용). 없으면 이모지 미표시(안전).
function findEmojiFont(): string {
  const p = path.join(process.cwd(), 'public/fonts/NotoColorEmoji.ttf');
  return fs.existsSync(p) ? p : '';
}

// ── 톤별 색상 팔레트 ──
interface TonePalette {
  hook: string;      // hook 섹션 강조색
  main: string;      // main 섹션 강조색
  cta: string;       // cta 섹션 강조색
  businessName: string; // 업체명 색상
  titleAccent: string;  // 제목 그라데이션 끝 색상
  subtitleColor: string; // 본문 자막 색상
}

const TONE_PALETTES: Record<string, TonePalette> = {
  '친근한': {
    hook: '#F59E0B',      // 따뜻한 앰버
    main: '#FB923C',      // 오렌지
    cta: '#F97316',       // 딥 오렌지
    businessName: '#FCD34D', // 밝은 노란
    titleAccent: '#FB923C',
    subtitleColor: '#FFFBEB', // 크림 화이트
  },
  '전문적인': {
    hook: '#3B82F6',      // 블루
    main: '#6366F1',      // 인디고
    cta: '#8B5CF6',       // 바이올렛
    businessName: '#93C5FD', // 라이트 블루
    titleAccent: '#818CF8',
    subtitleColor: '#EFF6FF', // 블루 화이트
  },
  '긴급한': {
    hook: '#EF4444',      // 레드
    main: '#F97316',      // 오렌지
    cta: '#DC2626',       // 딥 레드
    businessName: '#FCA5A5', // 라이트 레드
    titleAccent: '#F87171',
    subtitleColor: '#FFF7ED', // 웜 화이트
  },
  '따뜻한': {
    hook: '#A855F7',      // 퍼플
    main: '#EC4899',      // 핑크
    cta: '#F472B6',       // 라이트 핑크
    businessName: '#FDE68A', // 골든 옐로
    titleAccent: '#C084FC',
    subtitleColor: '#FDF4FF', // 퍼플 화이트
  },
};

// ── 헤더 디자인(상단 밴드) 테마 ──
// bg='blur'면 사진 블러 헤더, 그 외는 단색 밴드(hex). 업체명/제목 색은 헤더가 결정(톤 무관).
interface HeaderTheme {
  id: string;
  bg: string;               // 'blur' 또는 hex 예: '#121212'
  businessNameColor: string;
  titleColor: string;
  accent: string;           // 자막 구분선·진행바 색 (헤더와 통일)
  outline: string;          // 글자 외곽선 색 (밝은 배경 테마는 transparent로 얇게)
}
const DARK_OUTLINE = 'rgba(0,0,0,0.85)';
const HEADER_THEMES: Record<string, HeaderTheme> = {
  blur:     { id: 'blur',     bg: 'blur',    businessNameColor: '#FDE047', titleColor: '#FFFFFF', accent: '#FDE047', outline: DARK_OUTLINE },
  black:    { id: 'black',    bg: '#121212', businessNameColor: '#FFE600', titleColor: '#FFFFFF', accent: '#FFE600', outline: DARK_OUTLINE },
  navy:     { id: 'navy',     bg: '#0A192F', businessNameColor: '#00E5FF', titleColor: '#FFFFFF', accent: '#00E5FF', outline: DARK_OUTLINE },
  neon:     { id: 'neon',     bg: '#E5FF00', businessNameColor: '#14213D', titleColor: '#D32F2F', accent: '#D32F2F', outline: 'rgba(0,0,0,0)' },
  violet:   { id: 'violet',   bg: '#1A0B2E', businessNameColor: '#FF2A85', titleColor: '#FFFFFF', accent: '#FF2A85', outline: DARK_OUTLINE },
  burgundy: { id: 'burgundy', bg: '#4A0E17', businessNameColor: '#FFC107', titleColor: '#FFFFFF', accent: '#FFC107', outline: DARK_OUTLINE },
};
// 톤별 기본 헤더 (고급설정에서 미변경 시 자동 연결)
const TONE_DEFAULT_HEADER: Record<string, string> = {
  '친근한': 'blur', '전문적인': 'navy', '긴급한': 'burgundy', '따뜻한': 'violet',
};
function resolveHeaderTheme(headerTheme?: string, tone?: string): HeaderTheme {
  if (headerTheme && HEADER_THEMES[headerTheme]) return HEADER_THEMES[headerTheme];
  const mapped = (tone && TONE_DEFAULT_HEADER[tone]) || 'blur';
  return HEADER_THEMES[mapped] || HEADER_THEMES.blur;
}

function getTonePalette(tone?: string): TonePalette {
  if (tone && TONE_PALETTES[tone]) return TONE_PALETTES[tone];
  return TONE_PALETTES['친근한']; // 기본값
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

// Split a sentence into punchy 3~4 word chunks for sequential caption reveal.
// Chunks are balanced (avoids orphan single-word tails), e.g. 5 words → [3,2].
function splitIntoChunks(text: string, maxWords = 4): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [text];
  if (words.length <= maxWords) return [words.join(' ')];
  const numChunks = Math.ceil(words.length / maxWords);
  const per = Math.ceil(words.length / numChunks);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += per) {
    chunks.push(words.slice(i, i + per).join(' '));
  }
  return chunks;
}

// ── Fixed layout constants — Safe Zone 기반 (shared by both overlay functions) ──
// 쇼츠 Safe Zone: 상단 15% (288px), 하단 25% (480px) 확보
const H_FULL = 1920;
const SAFE_TOP = Math.round(H_FULL * 0.15);     // 288px — 상단 UI 영역
const SAFE_BOTTOM = Math.round(H_FULL * 0.25);  // 480px — 하단 UI 영역
// 상단 1/5 검은 밴드: 업체명 + 스크립트 제목 (사진은 하단 4/5)
const BAND_H = Math.round(H_FULL / 5);           // 384px — 상단 검은 배경 밴드
const TITLE_ZONE_Y = 44;                          // 밴드 내부 상단 여백
const TITLE_ZONE_H = BAND_H - 84;                 // 300px — 업체명 + 캐치프레이즈
const DIV_Y = TITLE_ZONE_Y + TITLE_ZONE_H + 16;
const BOX_W_MARGIN = 40;
const INFO_H = 84;
const INFO_BOTTOM_MARGIN = 60;
// Lower Third: 하단 Safe Zone 위에 배치
const BOX_H = 380;
const BOX_Y = H_FULL - SAFE_BOTTOM - BOX_H + 60; // Safe Zone 바로 위

// ── Text overlay PNG (transparent background) for Pexels video mode ──
// 자막 강조 색 순환 팔레트 (단어마다 노랑→하늘→핑크→라임)
const EM_COLORS = ['#FFE600', '#00E5FF', '#FF2D78', '#A6FF00'];

// 자막에서 *강조* 마커 구간을 크게+순환색으로 렌더 (자동 줄바꿈·중앙정렬)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawEmphasisCaption(ctx: any, text: string, o: {
  W: number; boxY: number; boxH: number; maxWidth: number;
  baseSize: number; baseColor: string; emColors: string[]; fontFamily: string;
  shadowColor: string; shadowBlur: number;
}): void {
  const emSize = Math.round(o.baseSize * 1.3);
  const lineGap = 18;
  const lineHeight = emSize + lineGap;
  type Tk = { t: string; em: boolean; ci: number; sp: boolean; w: number };
  const toks: Tk[] = [];
  let emIdx = 0;
  text.split('*').forEach((seg, si) => {
    const em = si % 2 === 1;
    const ci = em ? emIdx++ : -1;
    seg.split(/(\s+)/).forEach(part => {
      if (part.length) toks.push({ t: part, em, ci, sp: /^\s+$/.test(part), w: 0 });
    });
  });
  const sizeOf = (tk: Tk) => (tk.em ? emSize : o.baseSize);
  const lines: Tk[][] = [[]];
  let lw = 0;
  for (const tk of toks) {
    ctx.font = `bold ${sizeOf(tk)}px ${o.fontFamily}`;
    tk.w = ctx.measureText(tk.t).width;
    const cur = lines[lines.length - 1];
    if (!tk.sp && lw + tk.w > o.maxWidth && cur.length > 0) { lines.push([]); lw = 0; }
    const line = lines[lines.length - 1];
    if (line.length === 0 && tk.sp) continue; // 줄머리 공백 스킵
    line.push(tk); lw += tk.w;
  }
  const startY = o.boxY + (o.boxH - lines.length * lineHeight) / 2 + o.baseSize * 0.85;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = o.shadowColor;
  ctx.shadowBlur = o.shadowBlur;
  lines.forEach((line, li) => {
    const lineW = line.reduce((a, tk) => a + tk.w, 0);
    let x = (o.W - lineW) / 2;
    const y = startY + li * lineHeight;
    for (const tk of line) {
      ctx.font = `bold ${sizeOf(tk)}px ${o.fontFamily}`;
      ctx.fillStyle = tk.em ? o.emColors[tk.ci % o.emColors.length] : o.baseColor;
      ctx.fillText(tk.t, x, y);
      x += tk.w;
    }
  });
  ctx.shadowBlur = 0;
  ctx.textAlign = 'center';
}

// 마무리 CTA 엔드카드 (영상 끝 cta 구간) — 업체명·CTA·연락처 강조, 색은 헤더 테마 연동
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawEndcard(ctx: any, W: number, H: number, o: {
  businessName: string; ctaText?: string; contact?: string;
  bnColor: string; accentColor: string; fontFamily: string;
}): void {
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  };
  const lum = (hex: string) => {
    const m = hex.replace('#', ''); if (m.length < 6) return 0.5;
    const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  };
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `bold 50px ${o.fontFamily}`; ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText('지금 바로 👇', W / 2, H * 0.33);
  // 업체명 (폭 자동맞춤)
  let bn = 108; ctx.font = `bold ${bn}px ${o.fontFamily}`;
  while (bn > 56 && ctx.measureText(o.businessName).width > W - 140) { bn -= 4; ctx.font = `bold ${bn}px ${o.fontFamily}`; }
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 20;
  ctx.fillStyle = o.bnColor; ctx.fillText(o.businessName, W / 2, H * 0.43);
  ctx.shadowBlur = 0;
  if (o.ctaText) {
    ctx.font = `bold 60px ${o.fontFamily}`; ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 12;
    wrapKorean(o.ctaText, 16).split('\n').forEach((ln, i) => ctx.fillText(ln, W / 2, H * 0.51 + i * 74));
    ctx.shadowBlur = 0;
  }
  if (o.contact) {
    let ps = 48; ctx.font = `bold ${ps}px ${o.fontFamily}`;
    while (ps > 30 && ctx.measureText(o.contact).width > W - 160) { ps -= 3; ctx.font = `bold ${ps}px ${o.fontFamily}`; }
    const tw = ctx.measureText(o.contact).width;
    const pw = Math.min(W - 60, tw + 90), ph = ps + 56, px = (W - pw) / 2, py = H * 0.62;
    ctx.fillStyle = o.accentColor; rr(px, py, pw, ph, ph / 2); ctx.fill();
    ctx.fillStyle = lum(o.accentColor) > 0.6 ? '#111111' : '#ffffff';
    ctx.textBaseline = 'middle'; ctx.fillText(o.contact, W / 2, py + ph / 2); ctx.textBaseline = 'alphabetic';
  }
}

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
  palette?: TonePalette,
  headerBnColor?: string,
  headerTitleColor?: string,
  headerAccent?: string,
  headerOutline?: string,
): Promise<void> {
  const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas');

  const fontPath = findFont();
  const emojiPath = findEmojiFont();
  const fams: string[] = [];
  if (fontPath) {
    try { GlobalFonts.registerFromPath(fontPath, 'KoreanFont'); fams.push('KoreanFont'); } catch { /* system font */ }
  }
  if (emojiPath) {
    try { GlobalFonts.registerFromPath(emojiPath, 'EmojiFont'); fams.push('EmojiFont'); } catch { /* no emoji */ }
  }
  fams.push('sans-serif');
  const fontFamily = fams.join(', ');

  const W = 1080;
  const H = 1920;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Fully transparent background
  ctx.clearRect(0, 0, W, H);

  const p = palette || getTonePalette();
  const badgeColors: Record<string, string> = {
    hook: p.hook,
    main: p.main,
    cta: p.cta,
  };
  const accentColor = headerAccent || badgeColors[sectionType] || p.hook;

  // 마지막(cta) 구간은 엔드카드로 렌더 (업체명·CTA·연락처 강조)
  if (sectionType === 'cta' && displayBusinessName) {
    drawEndcard(ctx, W, H, {
      businessName: displayBusinessName, ctaText: text, contact: bottomInfo,
      bnColor: headerBnColor || '#FDE047', accentColor, fontFamily,
    });
    fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));
    return;
  }

  // (상단 색띠 제거 — 사용자 요청)

  // 모든 텍스트 중앙 정렬
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Brand watermark (무료 플랜만) — 밴드 좌상단 (중앙 업체명과 겹침 방지)
  if (showWatermark) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = `bold 30px ${fontFamily}`;
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 10;
    ctx.fillText('ShortsAI', 28, 46);
    ctx.textAlign = 'center';
  }
  ctx.shadowBlur = 0;

  // ── TITLE ZONE: optional business name (top, small) + catchy title (below, large) ──
  if (displayBusinessName || title) {
    if (displayBusinessName) {
      // Row 1 — business name: large bright yellow, auto-fit to width, bold black outline
      const bnMaxW = W - 120;
      let bnSize = 84;
      ctx.font = `bold ${bnSize}px ${fontFamily}`;
      while (bnSize > 56 && ctx.measureText(displayBusinessName).width > bnMaxW) {
        bnSize -= 4;
        ctx.font = `bold ${bnSize}px ${fontFamily}`;
      }
      const bnBaseline = TITLE_ZONE_Y + bnSize * 0.82;
      ctx.shadowColor = 'transparent'; // 업체명 그림자 제거 (네온 등 밝은 배경 얼룩 방지) — 외곽선만 유지
      ctx.shadowBlur = 0;
      ctx.strokeStyle = headerOutline || 'rgba(0,0,0,0.9)';
      ctx.lineWidth = 6;
      ctx.strokeText(displayBusinessName, W / 2, bnBaseline);
      ctx.fillStyle = headerBnColor || '#FDE047'; // 헤더 테마 업체명 색 (기본 노랑)
      ctx.fillText(displayBusinessName, W / 2, bnBaseline);
      ctx.shadowBlur = 0;
      // Thin separator glow under business name
      const sepY = bnBaseline + 26;
      const sepGrad = ctx.createLinearGradient(200, 0, W - 200, 0);
      sepGrad.addColorStop(0, 'transparent');
      sepGrad.addColorStop(0.5, accentColor + '55');
      sepGrad.addColorStop(1, 'transparent');
      ctx.strokeStyle = sepGrad;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(200, sepY);
      ctx.lineTo(W - 200, sepY);
      ctx.stroke();
    }

    if (title) {
      // Row 2 — catchy title: gradient bold text
      // When businessName is also shown, use the lower portion of the title zone
      const catchyZoneTop = displayBusinessName ? TITLE_ZONE_Y + 116 : TITLE_ZONE_Y;
      const catchyZoneH   = displayBusinessName ? TITLE_ZONE_H - 116 : TITLE_ZONE_H;
      const titleFontSize = displayBusinessName ? 66 : 78;
      const titleWrapped  = wrapKorean(title, 13);
      const titleLines    = titleWrapped.split('\n');
      const titleLineH    = titleFontSize + 14;
      const titleBlockH   = titleLines.length * titleLineH;
      const titleStartY   = catchyZoneTop + (catchyZoneH - titleBlockH) / 2 + titleFontSize * 0.85;

      ctx.font = `bold ${titleFontSize}px ${fontFamily}`;
      ctx.fillStyle = headerTitleColor || 'white'; // 헤더 테마 제목 색 (기본 흰색)
      ctx.strokeStyle = headerOutline || 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'transparent'; // 제목 그림자 제거 (사용자 요청) — 외곽선만으로 가독성 유지
      ctx.shadowBlur = 0;
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
  boxGrad.addColorStop(0.15, 'rgba(0,0,0,0.15)');
  boxGrad.addColorStop(0.5, 'rgba(0,0,0,0.3)');
  boxGrad.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = boxGrad;
  ctx.fillRect(boxX, effectiveBOX_Y - 60, boxW, effectiveBOX_H + 60);

  // 본문 자막 — *강조* 구절은 크게+헤더 accent색으로 (핵심 단어 시선 유도)
  drawEmphasisCaption(ctx, text, {
    W, boxY: effectiveBOX_Y, boxH: effectiveBOX_H, maxWidth: W - 120,
    baseSize: 62, baseColor: p.subtitleColor, emColors: EM_COLORS,
    fontFamily, shadowColor: 'rgba(0,0,0,0.95)', shadowBlur: 18,
  });

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
    ctx.font = `bold 44px ${fontFamily}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.shadowColor = 'rgba(0,0,0,1)';
    ctx.shadowBlur = 14;
    ctx.fillText(bottomInfo, W / 2, infoY + 52);
    ctx.shadowBlur = 0;
  }

  // Progress bar (Safe Zone 하단 경계에 배치)
  const barH = 10;
  const barY = H_FULL - SAFE_BOTTOM + 20;
  const barPad = 60;
  const barW = W - barPad * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
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
  fillGrad.addColorStop(1, accentColor); // 진행바도 헤더 accent로 통일
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
  palette?: TonePalette,
  headerBnColor?: string,
  headerTitleColor?: string,
  headerAccent?: string,
  headerOutline?: string,
): Promise<void> {
  const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas');

  const fontPath = findFont();
  const emojiPath = findEmojiFont();
  const fams: string[] = [];
  if (fontPath) {
    try { GlobalFonts.registerFromPath(fontPath, 'KoreanFont'); fams.push('KoreanFont'); } catch { /* system font */ }
  }
  if (emojiPath) {
    try { GlobalFonts.registerFromPath(emojiPath, 'EmojiFont'); fams.push('EmojiFont'); } catch { /* no emoji */ }
  }
  fams.push('sans-serif');
  const fontFamily = fams.join(', ');

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

  const p = palette || getTonePalette();
  const badgeColors: Record<string, string> = {
    hook: p.hook, main: p.main, cta: p.cta,
  };
  const accentColor = headerAccent || badgeColors[sectionType] || p.hook;

  // 마지막(cta) 구간은 엔드카드로 렌더 (업체명·CTA·연락처 강조)
  if (sectionType === 'cta' && displayBusinessName) {
    drawEndcard(ctx, W, H, {
      businessName: displayBusinessName, ctaText: text, contact: bottomInfo,
      bnColor: headerBnColor || '#FDE047', accentColor, fontFamily,
    });
    fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));
    return;
  }

  // (상단 색띠 제거 — 사용자 요청)

  // 모든 텍스트 중앙 정렬
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Brand watermark (무료 플랜만) — 좌상단
  if (showWatermark) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font = `bold 30px ${fontFamily}`;
    ctx.fillText('ShortsAI', 28, 46);
    ctx.textAlign = 'center';
  }

  // ── TITLE ZONE: optional business name (top, small) + catchy title (below, large) ──
  if (displayBusinessName || title) {
    if (displayBusinessName) {
      // Row 1 — business name: large bright yellow, auto-fit to width, bold black outline
      const bnMaxW = W - 120;
      let bnSize = 84;
      ctx.font = `bold ${bnSize}px ${fontFamily}`;
      while (bnSize > 56 && ctx.measureText(displayBusinessName).width > bnMaxW) {
        bnSize -= 4;
        ctx.font = `bold ${bnSize}px ${fontFamily}`;
      }
      const bnBaseline = TITLE_ZONE_Y + bnSize * 0.82;
      ctx.shadowColor = 'transparent'; // 업체명 그림자 제거 (네온 등 밝은 배경 얼룩 방지) — 외곽선만 유지
      ctx.shadowBlur = 0;
      ctx.strokeStyle = headerOutline || 'rgba(0,0,0,0.9)';
      ctx.lineWidth = 6;
      ctx.strokeText(displayBusinessName, W / 2, bnBaseline);
      ctx.fillStyle = headerBnColor || '#FDE047'; // 헤더 테마 업체명 색 (기본 노랑)
      ctx.fillText(displayBusinessName, W / 2, bnBaseline);
      ctx.shadowBlur = 0;
      // Thin separator glow under business name
      const sepY = bnBaseline + 26;
      const sepGrad = ctx.createLinearGradient(200, 0, W - 200, 0);
      sepGrad.addColorStop(0, 'transparent');
      sepGrad.addColorStop(0.5, accentColor + '55');
      sepGrad.addColorStop(1, 'transparent');
      ctx.strokeStyle = sepGrad;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(200, sepY);
      ctx.lineTo(W - 200, sepY);
      ctx.stroke();
    }

    if (title) {
      // Row 2 — catchy title: gradient bold text
      const catchyZoneTop = displayBusinessName ? TITLE_ZONE_Y + 116 : TITLE_ZONE_Y;
      const catchyZoneH   = displayBusinessName ? TITLE_ZONE_H - 116 : TITLE_ZONE_H;
      const titleFontSize = displayBusinessName ? 66 : 78;
      const titleWrapped  = wrapKorean(title, 13);
      const titleLines    = titleWrapped.split('\n');
      const titleLineH    = titleFontSize + 14;
      const titleBlockH   = titleLines.length * titleLineH;
      const titleStartY   = catchyZoneTop + (catchyZoneH - titleBlockH) / 2 + titleFontSize * 0.85;

      ctx.font = `bold ${titleFontSize}px ${fontFamily}`;
      ctx.fillStyle = headerTitleColor || 'white'; // 헤더 테마 제목 색 (기본 흰색)
      ctx.strokeStyle = headerOutline || 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'transparent'; // 제목 그림자 제거 (사용자 요청) — 외곽선만으로 가독성 유지
      ctx.shadowBlur = 0;
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
  boxGrad.addColorStop(0.15, 'rgba(0,0,0,0.15)');
  boxGrad.addColorStop(0.5, 'rgba(0,0,0,0.3)');
  boxGrad.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = boxGrad;
  ctx.fillRect(boxX, effectiveBOX_Y - 60, boxW, effectiveBOX_H + 60);

  // 본문 자막 — *강조* 구절은 크게+헤더 accent색으로
  drawEmphasisCaption(ctx, text, {
    W, boxY: effectiveBOX_Y, boxH: effectiveBOX_H, maxWidth: W - 120,
    baseSize: 62, baseColor: 'white', emColors: EM_COLORS,
    fontFamily, shadowColor: 'rgba(0,0,0,0.9)', shadowBlur: 16,
  });

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
    ctx.font = `bold 44px ${fontFamily}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.shadowColor = 'rgba(0,0,0,1)';
    ctx.shadowBlur = 14;
    ctx.fillText(bottomInfo, W / 2, infoY + 52);
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
  fillGrad.addColorStop(1, accentColor); // 진행바도 헤더 accent로 통일
  ctx.fillStyle = fillGrad;
  ctx.beginPath();
  ctx.roundRect(barPad, barY, fillW, barH, 4);
  ctx.fill();

  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outputPath, buffer);
}

// ── Mode 3: Create slideshow video from user-uploaded images ──────────────────
// BGM 트랙별 측정 BPM (비트 펄스용)
const BGM_BPM: Record<string, number> = {
  cafe: 85, professional: 119, energetic: 115, warm: 93, trendy: 119, calm: 108,
};

async function createImageSlideshowVideo(
  imagePaths: string[],
  totalDuration: number,
  outputPath: string,
  perImageDurations?: number[],
  bpm = 0,   // 0이면 비트 펄스 없음
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpegPath = require('ffmpeg-static') as string;

  // Use per-image durations if provided (sentence-aligned), otherwise equal split
  const durations = perImageDurations && perImageDurations.length === imagePaths.length
    ? perImageDurations
    : imagePaths.map(() => totalDuration / imagePaths.length);

  // 하단 사진영역(1080×1536)을 켄번스(천천히 줌인) + 장면전환(xfade)으로 생동감 부여.
  // 넘치면 좌우 크롭(무왜곡). 메모리 안전 위해 헤드룸 1.1배·ultrafast·threads 2·nice.
  const PHOTO_H = 1536; // 1920 - 384(상단 밴드)
  const N = imagePaths.length;
  const fps = 30;
  const T = 0.5; // 전환(xfade) 길이(초)
  // xfade 오버랩만큼 각 이미지 길이를 늘려 전체 길이를 totalDuration로 유지
  const pad = N > 1 ? (N - 1) * T / N : 0;
  const dur = durations.map(d => d + pad);
  const df = dur.map(d => Math.max(1, Math.round(d * fps)));

  const inputs = imagePaths.map((p, i) =>
    `-loop 1 -t ${dur[i].toFixed(3)} -i "${p}"`
  ).join(' ');

  // 켄번스: 1.1배 프리스케일 후 zoompan. 줌 속도를 이미지 길이에 비례시켜
  // 이미지 전체 구간 내내 "끊김없이 계속" 줌인 (긴 이미지에서 중간에 멈추는 문제 방지).
  const ZMAX = 1.18;
  // 비트 펄스(옵션): bpm>0이면 매 박자마다 살짝 줌 팝(1.5%). 이미지 넘어가도 위상 유지.
  const BF = bpm ? Math.round(60 / bpm * fps) : 0;
  const pAmp = 0.015, pDecay = BF ? (BF * 0.4).toFixed(1) : '1';
  const starts: number[] = [0];
  for (let i = 1; i < N; i++) starts.push(starts[i - 1] + dur[i - 1] - T);
  const zoom = imagePaths.map((_, i) => {
    const inc = ((ZMAX - 1) / df[i]).toFixed(6); // 프레임당 증가량 = 전체구간에 걸쳐 1.0→ZMAX
    const sf = Math.round(starts[i] * fps);
    const zexpr = bpm
      ? `1.0+${inc}*on+${pAmp}*max(0\\,1-mod(on+${sf}\\,${BF})/${pDecay})`
      : `min(zoom+${inc}\\,${ZMAX})`;
    return `[${i}:v]scale=1188:1690:force_original_aspect_ratio=increase,crop=1188:1690,` +
      `unsharp=5:5:0.8:5:5:0.0,` +   // 샤프닝(선명하게)
      `zoompan=z='${zexpr}':d=${df[i]}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x${PHOTO_H}:fps=${fps},setsar=1[v${i}]`;
  });

  // 장면전환(xfade) 체인 — 이미지마다 다른 효과
  const TRANS = ['slideleft', 'fade', 'wiperight', 'slideup', 'circleopen'];
  const parts = [...zoom];
  let outLabel = 'v0';
  if (N > 1) {
    let cum = dur[0];
    let prev = 'v0';
    for (let k = 0; k < N - 1; k++) {
      const off = (cum - T).toFixed(3);
      const lbl = (k === N - 2) ? 'out' : `x${k + 1}`;
      parts.push(`[${prev}][v${k + 1}]xfade=transition=${TRANS[k % TRANS.length]}:duration=${T}:offset=${off}[${lbl}]`);
      prev = lbl;
      cum += dur[k + 1];
    }
    outLabel = 'out';
  }
  const filterComplex = parts.join(';');

  const cmd = [
    `nice -n 12 "${ffmpegPath}"`,
    inputs,
    `-filter_complex "${filterComplex}"`,
    `-map "[${outLabel}]"`,
    `-threads 2`,
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
  tone?: string,
  headerTheme?: string,
  beatPulse?: boolean,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpegPath = require('ffmpeg-static') as string;

  const palette = getTonePalette(tone);
  const header = resolveHeaderTheme(headerTheme, tone);
  console.log(`[Video] Tone: ${tone || '(default)'} → palette: ${JSON.stringify({ hook: palette.hook, main: palette.main })} | Header: ${header.id} (bg=${header.bg})`);

  // BGM volume: use user-specified value, or auto (calm/trendy louder, others softer)
  const bgmVolume = externalBgmVolume !== undefined
    ? externalBgmVolume.toFixed(2)
    : (bgmId === 'calm' || bgmId === 'trendy') ? '0.95'
    : bgmId === 'professional' ? '0.31'   // 전문 비즈니스 10%p 상향 (0.21→0.31)
    : bgmId === 'energetic' ? '0.31'   // 활기찬 10%p 상향 (0.21→0.31)
    : '0.42';

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
      `[0:a][chime_d]amix=inputs=2:duration=longest:normalize=0[aout]" ` +
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

  // ── Build sentence list first (needed for image-script sync) ──
  // Apply stripContactFromText so sentence count matches TTS input exactly.
  // TTS strips phone/URL before splitting; we must do the same here.
  type SentenceItem = { sentence: string; sectionType: string; sectionIndex: number };
  const allSentences: SentenceItem[] = [];
  for (let i = 0; i < sections.length; i++) {
    const cleaned = stripContactFromText(sections[i].text);
    for (const sentence of splitIntoSentences(cleaned)) {
      allSentences.push({ sentence, sectionType: sections[i].type, sectionIndex: i });
    }
  }
  const totalChars = allSentences.reduce((s, item) => s + item.sentence.length, 0);

  // Sentence durations: use externally-supplied SSML timepoints when available,
  // otherwise fall back to proportional character-count estimation.
  const timepointsMatch = externalSentenceDurations && externalSentenceDurations.length === allSentences.length;
  if (externalSentenceDurations) {
    console.log(`[Video] Timepoints: TTS=${externalSentenceDurations.length}, video=${allSentences.length} → ${timepointsMatch ? 'MATCHED ✓' : 'MISMATCH ✗ (fallback to estimation)'}`);
  }
  const sentenceDurations: number[] = timepointsMatch
    ? externalSentenceDurations!
    : allSentences.map(item =>
        Math.max((item.sentence.length / totalChars) * audioDuration, 0.4)
      );
  const sentenceTimestamps: number[] = [];
  let cumTime = 0;
  for (const dur of sentenceDurations) {
    sentenceTimestamps.push(cumTime);
    cumTime += dur;
  }

  // ── Sub-split each sentence into punchy 3~4 word caption chunks ──
  // Sentence-level timing (above) stays intact for TTS sync & image slideshow;
  // each chunk gets a slice of its sentence's window, proportional to char length,
  // so captions reveal sequentially in step with the narration (karaoke-style).
  type ChunkItem = { text: string; sectionType: string; sectionIndex: number };
  const allChunks: ChunkItem[] = [];
  const chunkDurations: number[] = [];
  const chunkTimestamps: number[] = [];
  for (let i = 0; i < allSentences.length; i++) {
    const { sentence, sectionType, sectionIndex } = allSentences[i];
    const sentDur = sentenceDurations[i];
    const sentStart = sentenceTimestamps[i];
    const chunks = splitIntoChunks(sentence, 4);
    const totalLen = chunks.reduce((s, c) => s + c.length, 0) || 1;
    let cumLen = 0;
    for (const c of chunks) {
      const startFrac = cumLen / totalLen;
      cumLen += c.length;
      const endFrac = cumLen / totalLen;
      allChunks.push({ text: c, sectionType, sectionIndex });
      chunkTimestamps.push(sentStart + startFrac * sentDur);
      chunkDurations.push(Math.max((endFrac - startFrac) * sentDur, 0.25));
    }
  }
  console.log(`[Video] Caption chunks: ${allSentences.length} sentences → ${allChunks.length} chunks`);

  // ── Mode 3: User-uploaded images as slideshow background (highest priority) ──
  // Created AFTER sentence timing so we can align image transitions to sentence boundaries
  let videoPath: string | null = null;
  const validUserImages = (userImagePaths ?? []).filter(p => fs.existsSync(p));
  if (validUserImages.length > 0) {
    try {
      console.log(`[Video] Mode: user image slideshow (${validUserImages.length} images)`);
      const slideshowPath = path.join(tmpDir, 'slideshow_bg.mp4');

      // Distribute sentences across images by SECTION mapping (not evenly)
      // Script sections map 1:1 to images — section 0's sentences go to image 0, etc.
      const numImages = validUserImages.length;
      const numSections = sections.length;
      const perImageDurations: number[] = [];

      if (numSections === numImages) {
        // Perfect match: each section's sentences map to corresponding image
        for (let imgIdx = 0; imgIdx < numImages; imgIdx++) {
          let imgDur = 0;
          for (let sentIdx = 0; sentIdx < allSentences.length; sentIdx++) {
            if (allSentences[sentIdx].sectionIndex === imgIdx) {
              imgDur += sentenceDurations[sentIdx];
            }
          }
          perImageDurations.push(Math.max(imgDur, 0.5));
        }
        console.log(`[Video] Section-to-image mapping: ${numSections} sections → ${numImages} images (1:1)`);
      } else if (numImages < numSections) {
        // Fewer images than sections: group adjacent sections into images
        const sectionsPerImage = Math.floor(numSections / numImages);
        const extraSections = numSections % numImages;
        let secIdx = 0;
        for (let imgIdx = 0; imgIdx < numImages; imgIdx++) {
          const count = sectionsPerImage + (imgIdx < extraSections ? 1 : 0);
          let imgDur = 0;
          const assignedSections: number[] = [];
          for (let s = 0; s < count && secIdx < numSections; s++, secIdx++) {
            assignedSections.push(secIdx);
          }
          for (let sentIdx = 0; sentIdx < allSentences.length; sentIdx++) {
            if (assignedSections.includes(allSentences[sentIdx].sectionIndex)) {
              imgDur += sentenceDurations[sentIdx];
            }
          }
          perImageDurations.push(Math.max(imgDur, 0.5));
        }
        console.log(`[Video] Section-to-image mapping: ${numSections} sections → ${numImages} images (grouped)`);
      } else {
        // More images than sections: spread sections across images, extras get minimal duration
        for (let imgIdx = 0; imgIdx < numImages; imgIdx++) {
          if (imgIdx < numSections) {
            let imgDur = 0;
            for (let sentIdx = 0; sentIdx < allSentences.length; sentIdx++) {
              if (allSentences[sentIdx].sectionIndex === imgIdx) {
                imgDur += sentenceDurations[sentIdx];
              }
            }
            perImageDurations.push(Math.max(imgDur, 0.5));
          } else {
            perImageDurations.push(0.5); // extra images get minimal duration
          }
        }
        console.log(`[Video] Section-to-image mapping: ${numSections} sections → ${numImages} images (extras padded)`);
      }

      // Add buffer to last image for fadeout
      perImageDurations[perImageDurations.length - 1] += 2;

      console.log(`[Video] Image durations (sentence-aligned): ${perImageDurations.map(d => d.toFixed(1) + 's').join(', ')}`);
      await createImageSlideshowVideo(validUserImages, audioDuration + 2, slideshowPath, perImageDurations, beatPulse ? (BGM_BPM[bgmId || ''] || 0) : 0);
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

  if (videoPath) {
    // ════════════════════════════════════════════════════════
    // MODE 1: Pexels video plays continuously, text overlaid
    // ════════════════════════════════════════════════════════
    console.log('[Video] Mode: Pexels video overlay');

    // Generate transparent text overlay PNGs
    const overlayPaths: string[] = [];
    for (let idx = 0; idx < allChunks.length; idx++) {
      const { text, sectionType } = allChunks[idx];
      const overlayPath = path.join(tmpDir, `overlay_${idx}.png`);
      await createTextOverlay(
        script.title, text, sectionType,
        idx, allChunks.length, overlayPath,
        bottomInfo, displayBusinessName, showWatermark, palette,
        header.businessNameColor, header.titleColor, header.accent, header.outline,
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
    // 하단 4/5(1080×1536)를 사진/영상으로 꽉 채움(cover, 무왜곡, 넘치면 좌우 크롭).
    // 상단 1/5(BAND_H)은 헤더 테마: blur=사진 블러 헤더, 그 외=단색 밴드.
    const filterParts: string[] = [];
    if (header.bg === 'blur') {
      filterParts.push(
        `[0:v]split=2[src_fg][src_bg];` +
        `[src_bg]scale=1080:${H_FULL}:force_original_aspect_ratio=increase,` +
        `crop=1080:${H_FULL}:(iw-1080)/2:(ih-${H_FULL})/2,gblur=sigma=40,setsar=1[bgblur];` +
        `[src_fg]scale=1080:${H_FULL - BAND_H}:force_original_aspect_ratio=increase,` +
        `crop=1080:${H_FULL - BAND_H}:(iw-1080)/2:(ih-${H_FULL - BAND_H})/2,setsar=1[fg];` +
        `[bgblur][fg]overlay=0:${BAND_H}[bg0]`
      );
    } else {
      const bandColor = '0x' + header.bg.replace('#', '');
      filterParts.push(
        `[0:v]scale=1080:${H_FULL - BAND_H}:force_original_aspect_ratio=increase,` +
        `crop=1080:${H_FULL - BAND_H}:(iw-1080)/2:(ih-${H_FULL - BAND_H})/2,` +
        `pad=1080:${H_FULL}:0:${BAND_H}:${bandColor},setsar=1[bg0]`
      );
    }

    // Use between(t, start, end) so only ONE overlay is active at a time.
    // End time = next segment's start time → gap-free transitions.
    // (Fixed-size box ensures no trembling at transitions.)
    let prevLabel = 'bg0';
    for (let i = 0; i < overlayPaths.length; i++) {
      const tStart = chunkTimestamps[i].toFixed(3);
      const tEnd = i < overlayPaths.length - 1
        ? chunkTimestamps[i + 1].toFixed(3)
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
        `[${audioInputIdx}:a][bgm_adj]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0,alimiter=limit=0.95[aout]`
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
    for (let idx = 0; idx < allChunks.length; idx++) {
      const { text, sectionType } = allChunks[idx];
      const framePath = path.join(tmpDir, `frame_${idx}.png`);
      await createFrameImage(
        script.title, text, sectionType,
        idx, allChunks.length, framePath, keyword,
        bottomInfo, displayBusinessName, showWatermark, palette,
        header.businessNameColor, header.titleColor, header.accent, header.outline,
      );
      framePaths.push({ path: framePath, duration: chunkDurations[idx] });
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
        `[1:a][bgm_adj]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0,alimiter=limit=0.95[aout]`,
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
