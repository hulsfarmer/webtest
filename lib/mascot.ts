// lib/mascot.ts
// 오리지널 스틱 마스코트 — @napi-rs/canvas 렌더 라이브러리.
// 표정(face) · 포즈(pose) · 소품(prop)을 조합해 훅 장면을 그린다. (IP 안전 오리지널)
/* eslint-disable @typescript-eslint/no-explicit-any */

export type Face = 'worried' | 'shock' | 'dizzy' | 'annoyed' | 'happy' | 'sad' | 'neutral';
export type Pose = 'stand' | 'fall' | 'liftfoot' | 'holditem' | 'shiver' | 'headhold' | 'point' | 'shrug' | 'think';
export type Prop = 'qmark' | 'excl' | 'drops' | 'washer' | 'sweat';

export const FACES: Face[] = ['worried', 'shock', 'dizzy', 'annoyed', 'happy', 'sad', 'neutral'];
export const POSES: Pose[] = ['stand', 'fall', 'liftfoot', 'holditem', 'shiver', 'headhold', 'point', 'shrug', 'think'];

const DARK = '#2d2f34', RED = '#d62828', BLUE = '#4a8cd2', GREY = '#96989e', MATC = '#787d87';

function line(ctx: any, x1: number, y1: number, x2: number, y2: number, w: number) {
  ctx.beginPath(); ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.strokeStyle = ctx.strokeStyle || DARK;
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}
function circle(ctx: any, cx: number, cy: number, r: number, opt: { fill?: string; stroke?: string; w?: number }) {
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (opt.fill) { ctx.fillStyle = opt.fill; ctx.fill(); }
  if (opt.stroke) { ctx.strokeStyle = opt.stroke; ctx.lineWidth = opt.w || 4; ctx.stroke(); }
}

function drawFace(ctx: any, cx: number, cy: number, s: number, face: Face) {
  ctx.strokeStyle = DARK; ctx.fillStyle = DARK;
  const ex = 34 * s, ey = -10 * s;
  const eye = (px: number, py: number, r: number) => circle(ctx, px, py, r, { fill: DARK });
  if (face === 'shock') {
    for (const sx of [-1, 1]) { circle(ctx, cx + sx * ex, cy + ey, 14 * s, { stroke: DARK, w: 5 * s, fill: '#fff' }); eye(cx + sx * ex, cy + ey, 6 * s); }
  } else if (face === 'dizzy') {
    for (const sx of [-1, 1]) { const g = 13 * s; line(ctx, cx + sx * ex - g, cy + ey - g, cx + sx * ex + g, cy + ey + g, 5 * s); line(ctx, cx + sx * ex - g, cy + ey + g, cx + sx * ex + g, cy + ey - g, 5 * s); }
  } else if (face === 'happy') {
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.lineWidth = 6 * s; ctx.strokeStyle = DARK; ctx.arc(cx + sx * ex, cy + ey + 4 * s, 12 * s, Math.PI, 2 * Math.PI); ctx.stroke(); } // ^ ^ eyes
  } else {
    for (const sx of [-1, 1]) eye(cx + sx * ex, cy + ey, 9 * s);
    if (face === 'worried' || face === 'sad' || face === 'annoyed') {
      // 팔자 눈썹
      line(ctx, cx - ex - 18 * s, cy + ey - 24 * s, cx - ex + 12 * s, cy + ey - 14 * s, 6 * s);
      line(ctx, cx + ex + 18 * s, cy + ey - 24 * s, cx + ex - 12 * s, cy + ey - 14 * s, 6 * s);
    }
  }
  // 입
  const my = cy + 34 * s;
  if (face === 'shock') { circle(ctx, cx, my + 10 * s, 15 * s, { stroke: DARK, w: 6 * s, fill: '#fff' }); }
  else if (face === 'happy') { ctx.beginPath(); ctx.lineWidth = 6 * s; ctx.strokeStyle = DARK; ctx.arc(cx, my, 22 * s, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
  else if (face === 'sad' || face === 'worried') { ctx.beginPath(); ctx.lineWidth = 6 * s; ctx.strokeStyle = DARK; ctx.arc(cx, my + 28 * s, 22 * s, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke(); }
  else if (face === 'annoyed') { line(ctx, cx - 22 * s, my + 6 * s, cx + 22 * s, my + 6 * s, 6 * s); }
  else if (face === 'dizzy') { circle(ctx, cx, my + 6 * s, 12 * s, { stroke: DARK, w: 6 * s, fill: '#fff' }); }
  else { line(ctx, cx - 18 * s, my, cx + 18 * s, my, 6 * s); }
}

export function drawMark(ctx: any, cx: number, cy: number, kind: 'qmark' | 'excl', s: number, color = RED) {
  ctx.fillStyle = color; ctx.font = `bold ${Math.round(90 * s)}px KoreanBold, sans-serif`; ctx.textAlign = 'center';
  ctx.fillText(kind === 'qmark' ? '?' : '!', cx, cy);
  ctx.textAlign = 'left';
}
export function drawItem(ctx: any, cx: number, cy: number, label: string, s: number) {
  ctx.beginPath(); ctx.ellipse(cx, cy, 62 * s, 84 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#d2d5dc'; ctx.fill(); ctx.strokeStyle = MATC; ctx.lineWidth = 6 * s; ctx.stroke();
  if (label) { ctx.fillStyle = '#5a5f69'; ctx.font = `${Math.round(26 * s)}px KoreanBold, sans-serif`; ctx.textAlign = 'center'; ctx.fillText(label, cx, cy + 8 * s); ctx.textAlign = 'left'; }
}
export function drawWasher(ctx: any, cx: number, cy: number, s: number) {
  const w = 230 * s, h = 280 * s;
  ctx.strokeStyle = DARK; ctx.lineWidth = 11 * s; ctx.fillStyle = '#fff';
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 24 * s); ctx.fill(); ctx.stroke();
  line(ctx, cx - w / 2 + 12 * s, cy - h / 2 + 52 * s, cx + w / 2 - 12 * s, cy - h / 2 + 52 * s, 6 * s);
  circle(ctx, cx, cy + 20 * s, 70 * s, { stroke: DARK, w: 10 * s, fill: '#eef0f4' });
}
function drawDrops(ctx: any, cx: number, cy: number, s: number) {
  ctx.fillStyle = BLUE;
  for (const dy of [0, 50, 110]) { ctx.beginPath(); ctx.ellipse(cx, cy + dy * s, 9 * s, 15 * s, 0, 0, Math.PI * 2); ctx.fill(); }
}
function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** 마스코트 본체. cx,cy=머리 중심. */
export function drawMascot(ctx: any, cx: number, cy: number, opts: { pose?: Pose; face?: Face; s?: number }) {
  const s = opts.s ?? 2; const pose = opts.pose ?? 'stand'; const lw = 13 * s; const r = 80 * s;
  ctx.strokeStyle = DARK; ctx.fillStyle = DARK;
  // 포즈별 머리 위치 보정 + 몸
  const neck = cy + r, hip = neck + 150 * s, sh = neck + 18 * s;
  const L = (x1: number, y1: number, x2: number, y2: number) => line(ctx, x1, y1, x2, y2, lw);
  const legs = () => { L(cx, hip, cx - 45 * s, hip + 95 * s); L(cx, hip, cx + 45 * s, hip + 95 * s); };
  const armsHug = () => { L(cx, sh, cx - 70 * s, sh + 50 * s); L(cx, sh, cx + 70 * s, sh + 50 * s); L(cx - 70 * s, sh + 50 * s, cx - 30 * s, sh + 70 * s); L(cx + 70 * s, sh + 50 * s, cx + 30 * s, sh + 70 * s); };
  const armsDown = () => { L(cx, sh, cx - 60 * s, sh + 60 * s); L(cx, sh, cx + 60 * s, sh + 60 * s); };

  if (pose === 'fall') {
    // 넘어짐: 머리 낮게, 몸 대각, 다리 번쩍
    circle(ctx, cx, cy, r, { stroke: DARK, w: lw, fill: '#fff' }); drawFace(ctx, cx, cy, s, opts.face ?? 'dizzy');
    L(cx + 40 * s, cy + r - 10 * s, cx + 180 * s, hip - 40 * s);       // 몸통 대각
    L(cx + 180 * s, hip - 40 * s, cx + 150 * s, hip - 150 * s); L(cx + 180 * s, hip - 40 * s, cx + 230 * s, hip - 130 * s); // 다리 번쩍
    L(cx + 30 * s, cy + r, cx - 40 * s, cy + r + 70 * s); L(cx + 50 * s, cy + r - 20 * s, cx + 110 * s, cy + r - 60 * s);   // 팔
    return;
  }
  circle(ctx, cx, cy, r, { stroke: DARK, w: lw, fill: '#fff' });
  drawFace(ctx, cx, cy, s, opts.face ?? (pose === 'shiver' ? 'worried' : 'neutral'));
  if (pose === 'shiver') {
    L(cx, neck, cx, hip); armsHug(); legs();
    ctx.strokeStyle = BLUE; for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) { const bx = cx + sx * 150 * s, yy = cy - 50 * s + k * 34 * s; ctx.beginPath(); ctx.lineWidth = 8 * s; ctx.arc(bx, yy + 15 * s, 16 * s, sx < 0 ? 0.5 * Math.PI : 1.5 * Math.PI, sx < 0 ? 1.5 * Math.PI : 2.5 * Math.PI); ctx.stroke(); }
    ctx.strokeStyle = DARK;
  } else if (pose === 'headhold') {
    L(cx, neck, cx, hip); legs(); L(cx, sh, cx - 70 * s, cy - 30 * s); L(cx, sh, cx + 70 * s, cy - 30 * s); // 팔 머리로
  } else if (pose === 'liftfoot') {
    L(cx, neck, cx, hip); armsDown(); L(cx, hip, cx - 35 * s, hip + 95 * s);          // 선 다리
    L(cx, hip, cx + 55 * s, hip + 45 * s); L(cx + 55 * s, hip + 45 * s, cx + 30 * s, hip - 20 * s); // 든 다리
  } else if (pose === 'holditem') {
    L(cx, neck, cx, hip); legs(); L(cx, sh, cx + 95 * s, sh + 55 * s); L(cx, sh, cx + 150 * s, sh + 55 * s); // 앞으로 든 팔
  } else if (pose === 'point') {
    L(cx, neck, cx, hip); legs(); L(cx, sh, cx - 60 * s, sh + 60 * s); L(cx, sh, cx + 90 * s, sh - 20 * s); // 한 팔 가리킴
  } else if (pose === 'shrug') {
    L(cx, neck, cx, hip); legs(); L(cx, sh, cx - 75 * s, sh - 10 * s); L(cx - 75 * s, sh - 10 * s, cx - 95 * s, sh - 55 * s); L(cx, sh, cx + 75 * s, sh - 10 * s); L(cx + 75 * s, sh - 10 * s, cx + 95 * s, sh - 55 * s);
  } else if (pose === 'think') {
    L(cx, neck, cx, hip); legs(); L(cx, sh, cx - 60 * s, sh + 60 * s); L(cx, sh, cx + 40 * s, sh + 20 * s); L(cx + 40 * s, sh + 20 * s, cx + 30 * s, cy + 30 * s); // 턱에 손
  } else { // stand
    L(cx, neck, cx, hip); armsDown(); legs();
  }
}

/** 훅 장면 소품 배치 (마스코트 기준). */
export function drawSceneProps(ctx: any, cx: number, headCy: number, s: number, spec: { prop?: Prop; label?: string; item?: boolean; itemLabel?: string; washer?: boolean; drops?: boolean; mark?: 'qmark' | 'excl' }) {
  const hip = headCy + 80 * s + 150 * s;
  if (spec.washer) drawWasher(ctx, cx + 190 * s, headCy + 180 * s, s);
  if (spec.item) drawItem(ctx, cx + 140 * s, headCy + 150 * s, spec.itemLabel || '', s);
  if (spec.drops) drawDrops(ctx, cx + 30 * s, hip - 10 * s, s);
  if (spec.mark) drawMark(ctx, cx + (spec.mark === 'qmark' ? -20 : 170) * s, headCy - 120 * s, spec.mark, s);
}
