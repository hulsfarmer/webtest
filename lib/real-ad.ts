// lib/real-ad.ts
// 실사 제품광고 쇼츠 조립기 (관리자 신메뉴 프로토타입).
// 슬롯(훅/홍보1~4/CTA) = 문구 + 미디어(이미지·영상·GIF) + 나레이션.
// 카드 프레임은 @napi-rs/canvas 로 렌더(아이보리 카드 디자인), 미디어는 ffmpeg overlay.
// 나레이션은 슬롯별 연속 오디오로 깔아 끊김 방지, BGM 은 일정 볼륨(덕킹 없음).
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { drawMascot, drawSceneProps, type Pose, type Face } from './mascot';
import { generateHookImages } from './hook-image';

const execAsync = promisify(exec);

// ── 디자인 상수 (수작업 러프컷과 동일 톤) ──
const W = 1080, H = 1920;
const IVORY = '#F7F4EF';
const DARK = '#26282C';
const GREY = '#787A80';
const ACCENT = '#B76E46';
const RED = '#D62828';
const CARD = '#FFFFFF';
const SHADOW = '#DED8CE';
const CARD_X = 40, CARD_Y = 660, CARD_W = 1000, CARD_H = 640;

export type SlotKind = 'hook' | 'promo' | 'cta';

export interface RealAdSlot {
  kind: SlotKind;
  /** 훅: 고민 줄들(빌드업) + 마지막 질문은 question. 홍보/CTA: 제목 1~2줄 */
  lines: string[];
  question?: string;       // 훅 펀치라인
  scenes?: HookSceneSpec[];// 훅: 고민별 마스코트 장면 (있으면 텍스트 빌드업 대신 사용)
  badge?: string;          // 상단 배지(선택)
  priceText?: string;      // CTA 가격
  footerText?: string;     // 하단(기본 브랜드명)
  mediaPath?: string;      // 홍보/CTA 카드에 얹을 이미지/영상/GIF (훅은 보통 없음)
  narration: string;       // TTS 원고
}

export interface HookSceneSpec {
  text: string;
  imgPrompt?: string;   // AI 일러스트 생성용(있으면 우선)
  pose?: string;
  face?: string;
  prop?: string;
  item?: boolean;
  itemLabel?: string;
}

export interface RealAdInput {
  slots: RealAdSlot[];
  bgmPath?: string | null;
  bgmVolume?: number;      // 기본 0.5
  brandName?: string;      // 기본 하단 표기
}

// 폰트 등록 (프로젝트 public/fonts 우선)
function fontFamily(): string {
  return "'KoreanBold', 'KoreanBody', sans-serif";
}
async function registerFonts() {
  const { GlobalFonts } = await import('@napi-rs/canvas');
  // 실사 광고 확정 폰트: Pretendard (우리가 완성한 영상에서 사용) → 없으면 Noto/BlackHanSans 대체
  const body = [
    path.join(process.cwd(), 'public/fonts/Pretendard-Medium.ttf'),
    path.join(process.cwd(), 'public/fonts/NotoSansKR-Regular.ttf'),
    '/System/Library/Fonts/AppleSDGothicNeo.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  ].find((f) => fs.existsSync(f));
  const bold = [
    path.join(process.cwd(), 'public/fonts/Pretendard-SemiBold.ttf'),
    path.join(process.cwd(), 'public/fonts/BlackHanSans-Regular.ttf'),
    path.join(process.cwd(), 'public/fonts/NotoSansKR-Regular.ttf'),
  ].find((f) => fs.existsSync(f));
  if (body) try { GlobalFonts.registerFromPath(body, 'KoreanBody'); } catch { /* noop */ }
  // 굵은 임팩트용 — 없으면 body 로 대체
  if (bold) try { GlobalFonts.registerFromPath(bold, 'KoreanBold'); } catch { /* noop */ }
}

function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 폭에 맞춰 폰트 크기 자동 축소 */
function fitFont(ctx: any, lines: string[], start: number, min: number, maxW: number, weight = 'bold'): number {
  let s = start;
  while (s > min) {
    ctx.font = `${weight} ${s}px ${fontFamily()}`;
    if (Math.max(...lines.map((t) => ctx.measureText(t).width)) <= maxW) return s;
    s -= 2;
  }
  return min;
}

function drawCenterLines(ctx: any, lines: string[], cy: number, size: number, color: string, weight = 'bold', gap = 18) {
  ctx.font = `${weight} ${size}px ${fontFamily()}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const lh = size * 1.25;
  const total = lines.length * lh + (lines.length - 1) * gap;
  let y = cy - total / 2 + size;
  for (const ln of lines) { ctx.fillText(ln, W / 2, y); y += lh + gap; }
}

/** 카드형 프레임(홍보/CTA) 렌더 → PNG 저장 */
async function renderCardFrame(slot: RealAdSlot, showPains: number, out: string, brandName: string) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = IVORY; ctx.fillRect(0, 0, W, H);

  // 배지
  if (slot.badge) {
    ctx.font = `bold 34px ${fontFamily()}`;
    ctx.textAlign = 'center';
    const bw = ctx.measureText(slot.badge).width, pad = 26;
    roundRect(ctx, (W - (bw + pad * 2)) / 2, 150, bw + pad * 2, 64, 32);
    ctx.fillStyle = ACCENT; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(slot.badge, W / 2, 194);
  }
  // 상단 문구
  ctx.textAlign = 'center';
  const capSize = fitFont(ctx, slot.lines, 64, 40, 920);
  drawCenterLines(ctx, slot.lines, 400, capSize, DARK);

  // 카드(그림자 + 흰 카드)
  ctx.fillStyle = SHADOW; roundRect(ctx, CARD_X - 8, CARD_Y + 10, CARD_W + 16, CARD_H + 8, 40); ctx.fill();
  ctx.fillStyle = CARD; roundRect(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, 36); ctx.fill();

  // CTA 가격/하단
  if (slot.priceText) {
    ctx.font = `bold 92px ${fontFamily()}`; ctx.fillStyle = ACCENT; ctx.textAlign = 'center';
    ctx.fillText(slot.priceText, W / 2, 1540);
    ctx.font = `500 40px ${fontFamily()}`; ctx.fillStyle = GREY;
    ctx.fillText('욕실 · 주방 · 현관 어디든', W / 2, 1610);
  } else {
    ctx.font = `500 38px ${fontFamily()}`; ctx.fillStyle = GREY; ctx.textAlign = 'center';
    ctx.fillText(slot.footerText || brandName, W / 2, 1540);
  }
  showPains; // (홍보 카드에선 미사용)
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
}

/** 훅 빌드업 프레임: 고민 n개 + (질문 표시 여부) */
async function renderHookFrame(lines: string[], n: number, question: string | undefined, showQ: boolean, out: string) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = IVORY; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  const slots = [640, 820, 1000, 1180];
  ctx.font = `bold 86px ${fontFamily()}`;
  ctx.fillStyle = RED;
  for (let i = 0; i < n && i < lines.length; i++) ctx.fillText(lines[i], W / 2, slots[i] + 86);
  if (showQ && question) {
    ctx.font = `bold 60px ${fontFamily()}`; ctx.fillStyle = DARK;
    ctx.fillText(question, W / 2, 1320);
  }
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
}

/** 마스코트 훅 장면 렌더: 고민 텍스트(위) + 마스코트(포즈/표정) + 소품 + 질문(마지막) */
async function renderMascotScene(scene: HookSceneSpec, showQ: boolean, question: string | undefined, out: string) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = IVORY; ctx.fillRect(0, 0, W, H);
  // 고민 텍스트 (상단, 빨강)
  ctx.font = `bold 84px ${fontFamily()}`; ctx.fillStyle = RED; ctx.textAlign = 'center';
  ctx.fillText(scene.text, W / 2, 430);
  ctx.textAlign = 'left';
  // 마스코트 (중앙)
  const s = 2, cx = W / 2, cy = 1080;
  drawMascot(ctx, cx, cy, { pose: (scene.pose || 'stand') as Pose, face: (scene.face || 'worried') as Face, s });
  drawSceneProps(ctx, cx, cy, s, {
    item: !!scene.item, itemLabel: scene.itemLabel,
    washer: scene.prop === 'washer',
    drops: scene.prop === 'drops',
    mark: scene.prop === 'qmark' ? 'qmark' : scene.prop === 'excl' ? 'excl' : undefined,
    prop: scene.prop as never,
  });
  if (showQ && question) {
    ctx.font = `bold 54px ${fontFamily()}`; ctx.fillStyle = DARK; ctx.textAlign = 'center';
    ctx.fillText(question, W / 2, 1620); ctx.textAlign = 'left';
  }
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
}

/** AI 일러스트 장면 렌더: 일러스트(배경) + 고민 자막(상단) + 질문(마지막) */
async function renderIllustratedScene(imagePath: string, painText: string, showQ: boolean, question: string | undefined, out: string) {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const img = await loadImage(imagePath);
  // 폭 W 맞춰 배치, 배경은 이미지 좌상단 색으로 채움(이음새 없음)
  const iw = W, ih = Math.round((img.height / img.width) * W);
  // 배경색 추정: 작은 임시 캔버스로 코너 픽셀
  const tmp = createCanvas(2, 2); const tctx = tmp.getContext('2d'); tctx.drawImage(img, 0, 0, 2, 2);
  const px = tctx.getImageData(0, 0, 1, 1).data;
  ctx.fillStyle = `rgb(${px[0]},${px[1]},${px[2]})`; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, 0, (H - ih) / 2, iw, ih);
  // 고민 자막
  ctx.font = `bold 84px ${fontFamily()}`; ctx.fillStyle = RED; ctx.textAlign = 'center';
  ctx.fillText(painText, W / 2, 360); ctx.textAlign = 'left';
  if (showQ && question) {
    ctx.fillStyle = `rgb(${px[0]},${px[1]},${px[2]})`; ctx.fillRect(0, 1690, W, 120);
    ctx.font = `bold 54px ${fontFamily()}`; ctx.fillStyle = DARK; ctx.textAlign = 'center';
    ctx.fillText(question, W / 2, 1752); ctx.textAlign = 'left';
  }
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
}

function sh(cmd: string) { return execAsync(cmd, { maxBuffer: 1 << 26 }); }
async function dur(f: string): Promise<number> {
  const { stdout } = await sh(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${f}"`);
  return parseFloat(stdout.trim()) || 0;
}
function isVideo(p: string) { return /\.(mp4|mov|webm|m4v|gif)$/i.test(p); }

/** 슬롯 미디어를 카드 위에 올린 무음 비디오 세그먼트 생성 */
async function buildCardSeg(frame: string, media: string | undefined, d: number, out: string) {
  const ov = `overlay=(W-w)/2:660+(640-h)/2:shortest=1`;
  if (!media) {
    await sh(`ffmpeg -v error -loop 1 -i "${frame}" -t ${d.toFixed(3)} -vf "fps=30,scale=1080:1920" -an -c:v libx264 -pix_fmt yuv420p -r 30 -preset veryfast "${out}" -y`);
    return;
  }
  // 이미지: 카드 폭 맞춤 / 영상·GIF: 루프
  const scale = `scale='min(920,iw*600/ih)':'min(600,ih*920/iw)'`;
  if (isVideo(media)) {
    await sh(`ffmpeg -v error -loop 1 -i "${frame}" -stream_loop -1 -i "${media}" -filter_complex "[1:v]${scale},fps=30[c];[0:v]fps=30[bg];[bg][c]${ov}[v]" -map "[v]" -t ${d.toFixed(3)} -an -c:v libx264 -pix_fmt yuv420p -r 30 -preset veryfast "${out}" -y`);
  } else {
    await sh(`ffmpeg -v error -loop 1 -i "${frame}" -loop 1 -i "${media}" -filter_complex "[1:v]${scale},fps=30[c];[0:v]fps=30[bg];[bg][c]${ov}[v]" -map "[v]" -t ${d.toFixed(3)} -an -c:v libx264 -pix_fmt yuv420p -r 30 -preset veryfast "${out}" -y`);
  }
}

/**
 * 실사 제품광고 조립.
 * @param ttsFn 슬롯 나레이션 → wav/mp3 경로 (주입식: 테스트 시 스텁 가능)
 */
export async function assembleRealAd(
  input: RealAdInput,
  ttsFn: (text: string, outPath: string, kind?: SlotKind) => Promise<void>,
  workDir: string,
  outPath: string,
): Promise<{ path: string; duration: number }> {
  await registerFonts();
  fs.mkdirSync(workDir, { recursive: true });
  const brand = input.brandName || '';
  const vids: string[] = [];
  const auds: string[] = [];
  let idx = 0;

  for (const slot of input.slots) {
    // 나레이션 생성 → 길이 측정
    const vo = path.join(workDir, `vo_${idx}.mp3`);
    await ttsFn(slot.narration, vo, slot.kind);
    const vd = await dur(vo);

    if (slot.kind === 'hook' && slot.scenes && slot.scenes.length) {
      // 훅: 장면마다 최소 표시시간(1.8s), 단일 나레이션을 총길이에 패딩(목소리 일관)
      const sc = slot.scenes;
      const each = Math.max(1.8, vd / sc.length);
      // imgPrompt 있으면 AI 일러스트 훅(첫 장면 레퍼런스로 일관성), 실패 시 스틱 폴백
      let illust: string[] | null = null;
      if (sc.some((x) => x.imgPrompt)) {
        try { illust = await generateHookImages(sc.map((x) => x.imgPrompt || x.text), workDir); }
        catch (e) { console.warn('[real-ad] 훅 일러스트 생성 실패 → 스틱 폴백:', e instanceof Error ? e.message : e); illust = null; }
      }
      for (let k = 0; k < sc.length; k++) {
        const fr = path.join(workDir, `mhook_${idx}_${k}.png`);
        const showQ = k === sc.length - 1 && !!slot.question;
        if (illust && illust[k]) await renderIllustratedScene(illust[k], sc[k].text, showQ, slot.question, fr);
        else await renderMascotScene(sc[k], showQ, slot.question, fr);
        const seg = path.join(workDir, `v_${idx}_${k}.mp4`);
        await buildCardSeg(fr, undefined, each, seg); vids.push(seg);
      }
      const total = each * sc.length;
      const ao = path.join(workDir, `a_${idx}.wav`);
      await sh(`ffmpeg -v error -i "${vo}" -af "apad=whole_dur=${total.toFixed(3)}" -t ${total.toFixed(3)} -ar 44100 -ac 1 "${ao}" -y`);
      auds.push(ao);
    } else if (slot.kind === 'hook') {
      // (폴백) 텍스트 빌드업
      const n = slot.lines.length;
      const beats = n + (slot.question ? 1 : 0);
      const each = Math.max(0.6, vd / beats);
      for (let k = 1; k <= n; k++) {
        const fr = path.join(workDir, `hook_${idx}_${k}.png`);
        await renderHookFrame(slot.lines, k, slot.question, false, fr);
        const seg = path.join(workDir, `v_${idx}_${k}.mp4`);
        await buildCardSeg(fr, undefined, each, seg); vids.push(seg);
      }
      if (slot.question) {
        const fr = path.join(workDir, `hook_${idx}_q.png`);
        await renderHookFrame(slot.lines, n, slot.question, true, fr);
        const seg = path.join(workDir, `v_${idx}_q.mp4`);
        await buildCardSeg(fr, undefined, each + 0.4, seg); vids.push(seg);
      }
      const total = each * n + (slot.question ? each + 0.4 : 0);
      const ao = path.join(workDir, `a_${idx}.wav`);
      await sh(`ffmpeg -v error -i "${vo}" -af "apad=whole_dur=${total.toFixed(3)}" -t ${total.toFixed(3)} -ar 44100 -ac 1 "${ao}" -y`);
      auds.push(ao);
    } else {
      const d = vd + (slot.kind === 'cta' ? 0.7 : 0.4);
      const fr = path.join(workDir, `card_${idx}.png`);
      await renderCardFrame(slot, 0, fr, brand);
      const seg = path.join(workDir, `v_${idx}.mp4`);
      await buildCardSeg(fr, slot.mediaPath, d, seg); vids.push(seg);
      const ao = path.join(workDir, `a_${idx}.wav`);
      await sh(`ffmpeg -v error -i "${vo}" -af "apad=whole_dur=${d.toFixed(3)}" -t ${d.toFixed(3)} -ar 44100 -ac 1 "${ao}" -y`);
      auds.push(ao);
    }
    idx++;
  }

  // concat 리스트
  const vlist = path.join(workDir, 'vlist.txt');
  const alist = path.join(workDir, 'alist.txt');
  fs.writeFileSync(vlist, vids.map((v) => `file '${v}'`).join('\n'));
  fs.writeFileSync(alist, auds.map((a) => `file '${a}'`).join('\n'));
  const vidCat = path.join(workDir, 'vid.mp4');
  const audCat = path.join(workDir, 'master.wav');
  await sh(`ffmpeg -v error -f concat -safe 0 -i "${vlist}" -c copy "${vidCat}" -y`);
  await sh(`ffmpeg -v error -f concat -safe 0 -i "${alist}" -c copy "${audCat}" -y`);
  const total = await dur(vidCat);

  // BGM 믹스(일정 볼륨, 덕킹 없음) + 끝 페이드아웃 + 리미터, faststart 재인코딩
  const vol = input.bgmVolume ?? 0.5;
  const fadeSt = Math.max(0, total - 0.9).toFixed(3);
  if (input.bgmPath && fs.existsSync(input.bgmPath)) {
    await sh(`ffmpeg -v error -stream_loop -1 -i "${input.bgmPath}" -i "${vidCat}" -i "${audCat}" -filter_complex "[0:a]aresample=44100,volume=${vol},afade=t=out:st=${fadeSt}:d=0.9[bgm];[2:a]aresample=44100[vo];[vo][bgm]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]" -map 1:v -map "[a]" -c:v libx264 -pix_fmt yuv420p -preset veryfast -c:a aac -b:a 192k -ar 44100 -movflags +faststart -shortest "${outPath}" -y`);
  } else {
    await sh(`ffmpeg -v error -i "${vidCat}" -i "${audCat}" -map 0:v -map 1:a -c:v libx264 -pix_fmt yuv420p -preset veryfast -c:a aac -b:a 192k -ar 44100 -movflags +faststart -shortest "${outPath}" -y`);
  }
  return { path: outPath, duration: await dur(outPath) };
}
