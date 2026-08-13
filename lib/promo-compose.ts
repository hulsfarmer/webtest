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

const W = 1080, H = 1920;
// PiP 레이아웃
export const PIP = 360;      // 원형 캐릭터 지름
export const RING = 380;     // 흰 테두리 포함 지름
export const CROP_Y = 40;    // 캐릭터 상단 크롭(정수리 포함)
const PIPX = W - RING - 48;  // 우하단
const PIPY = H - RING - 300;

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

/** 상단 제목 + 하단 CTA 텍스트 오버레이 PNG (1080x1920 투명 + 그라데이션) */
export async function renderPromoOverlay(title: string, cta: string, outPath: string): Promise<void> {
  const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas');
  const titleFont = findFont(true), bodyFont = findFont(false);
  const fams: { title: string; body: string } = { title: 'sans-serif', body: 'sans-serif' };
  try { if (titleFont) { GlobalFonts.registerFromPath(titleFont, 'PromoTitle'); fams.title = 'PromoTitle'; } } catch { /* noop */ }
  try { if (bodyFont) { GlobalFonts.registerFromPath(bodyFont, 'PromoBody'); fams.body = 'PromoBody'; } } catch { /* noop */ }

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 상단 그라데이션
  let g = ctx.createLinearGradient(0, 0, 0, 300);
  g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 300);
  // 하단 그라데이션
  g = ctx.createLinearGradient(0, H - 320, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.63)');
  ctx.fillStyle = g; ctx.fillRect(0, H - 320, W, 320);

  ctx.textAlign = 'center';
  // 제목
  ctx.font = `88px "${fams.title}"`;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillText(title, W / 2 + 3, 150 + 3);
  ctx.fillStyle = '#ffffff'; ctx.fillText(title, W / 2, 150);
  // CTA
  ctx.font = `52px "${fams.body}"`;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillText(cta, W / 2 + 2, H - 150 + 2);
  ctx.fillStyle = '#ffffff'; ctx.fillText(cta, W / 2, H - 150);

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

/** ffmpeg 인터컷+PiP 합성. 구간: [0,t1) 캐릭터풀샷, [t1,t2) 제품+PiP, [t2,D) 캐릭터풀샷 */
export async function composePromoCharacter(opts: {
  productImagePath: string;
  characterVideoPath: string;
  overlayPath: string;
  pipMaskPath: string;
  ringPath: string;
  durationSec: number;
  t1: number;
  t2: number;
  outPath: string;
}): Promise<void> {
  const ffmpeg = require('ffmpeg-static') as string;
  const { productImagePath, characterVideoPath, overlayPath, pipMaskPath, ringPath, durationSec, t1, t2, outPath } = opts;

  const filter = [
    `[1:v]split=3[v1][v2][v3]`,
    `[v1]scale=${W}:${H},setsar=1[cf1]`,
    `[v2]scale=${W}:${H},setsar=1[cf2]`,
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[bgs]`,
    `[bgs][2:v]overlay=0:0[bgt]`,
    `[v3]crop=720:720:0:${CROP_Y},scale=${PIP}:${PIP}[pipraw]`,
    `[pipraw][3:v]alphamerge[pipc]`,
    `[4:v][pipc]overlay=(W-w)/2:(H-h)/2[pipring]`,
    `[bgt][pipring]overlay=${PIPX}:${PIPY}[mid]`,
    `[cf1]trim=0:${t1},setpts=PTS-STARTPTS[s1]`,
    `[mid]trim=${t1}:${t2},setpts=PTS-STARTPTS[s2]`,
    `[cf2]trim=${t2}:${durationSec},setpts=PTS-STARTPTS[s3]`,
    `[s1][s2][s3]concat=n=3:v=1[outv]`,
  ].join(';');

  const cmd = [
    `"${ffmpeg}" -y -loglevel error`,
    `-loop 1 -i "${productImagePath}"`,
    `-i "${characterVideoPath}"`,
    `-loop 1 -i "${overlayPath}"`,
    `-loop 1 -i "${pipMaskPath}"`,
    `-loop 1 -i "${ringPath}"`,
    `-filter_complex "${filter}"`,
    `-map "[outv]" -map "1:a" -r 30`,
    `-c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart`,
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
