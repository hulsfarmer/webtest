// lib/mascot.ts
// 오리지널 스틱 마스코트 — @napi-rs/canvas 렌더 라이브러리.
// 표정(face) · 포즈(pose) · 소품(prop)을 조합해 훅 장면을 그린다. (IP 안전 오리지널)
/* eslint-disable @typescript-eslint/no-explicit-any */

export type Face = 'worried' | 'shock' | 'dizzy' | 'annoyed' | 'happy' | 'sad' | 'neutral' | 'cold' | 'hot'
  | 'love' | 'cry' | 'sleepy' | 'angry' | 'disgust' | 'wink';
export type Pose = 'stand' | 'fall' | 'liftfoot' | 'holditem' | 'shiver' | 'headhold' | 'point' | 'shrug' | 'think'
  | 'onearm' | 'twoarms' | 'oneleg' | 'jump' | 'run'
  | 'sit' | 'liedown' | 'clap' | 'thumbsup' | 'nosepinch' | 'facepalm' | 'armscross' | 'wave';
export type Dir = 'front' | 'back' | 'up' | 'down';
export type Prop = 'qmark' | 'excl' | 'drops' | 'washer' | 'sweat' | 'hearts' | 'zzz' | 'coin' | 'stink' | 'sparkle';

export const FACES: Face[] = ['worried', 'shock', 'dizzy', 'annoyed', 'happy', 'sad', 'neutral', 'cold', 'hot', 'love', 'cry', 'sleepy', 'angry', 'disgust', 'wink'];
export const POSES: Pose[] = ['stand', 'fall', 'liftfoot', 'holditem', 'shiver', 'headhold', 'point', 'shrug', 'think', 'onearm', 'twoarms', 'oneleg', 'jump', 'run', 'sit', 'liedown', 'clap', 'thumbsup', 'nosepinch', 'facepalm', 'armscross', 'wave'];
export const DIRS: Dir[] = ['front', 'back', 'up', 'down'];

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

function heart(ctx: any, cx: number, cy: number, r: number, color: string) {
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.9);
  ctx.bezierCurveTo(cx - r * 1.3, cy - r * 0.4, cx - r * 0.5, cy - r * 1.1, cx, cy - r * 0.35);
  ctx.bezierCurveTo(cx + r * 0.5, cy - r * 1.1, cx + r * 1.3, cy - r * 0.4, cx, cy + r * 0.9);
  ctx.closePath(); ctx.fill();
}

function drawFace(ctx: any, cx: number, cy: number, s: number, face: Face, dir: Dir = 'front') {
  ctx.strokeStyle = DARK; ctx.fillStyle = DARK;
  // 뒤통수: 얼굴 없음 + 머리 가마
  if (dir === 'back') {
    ctx.strokeStyle = DARK; ctx.lineWidth = 6 * s;
    for (const dx of [-16, 0, 16]) { ctx.beginPath(); ctx.moveTo(cx + dx * s, cy - 55 * s); ctx.lineTo(cx + dx * s + 8 * s, cy - 78 * s); ctx.stroke(); }
    return;
  }
  const ex = 34 * s, ey = (dir === 'up' ? -30 : dir === 'down' ? 8 : -10) * s;
  const eye = (px: number, py: number, r: number) => circle(ctx, px, py, r, { fill: DARK });
  // 추위/더위 특수 표정
  if (face === 'cold') {
    for (const sx of [-1, 1]) eye(cx + sx * ex, cy + ey, 9 * s);
    line(ctx, cx - ex - 18 * s, cy + ey - 24 * s, cx - ex + 12 * s, cy + ey - 14 * s, 6 * s);
    line(ctx, cx + ex + 18 * s, cy + ey - 24 * s, cx + ex - 12 * s, cy + ey - 14 * s, 6 * s);
    // 덜덜 이(악문 입: 사각 + 세로선)
    const my = cy + 34 * s; ctx.strokeStyle = DARK; ctx.lineWidth = 5 * s;
    ctx.strokeRect(cx - 24 * s, my - 6 * s, 48 * s, 22 * s);
    for (const vx of [-8, 8]) line(ctx, cx + vx * s, my - 6 * s, cx + vx * s, my + 16 * s, 3 * s);
    line(ctx, cx - 24 * s, my + 5 * s, cx + 24 * s, my + 5 * s, 3 * s);
    // 파란 냉기 볼
    ctx.strokeStyle = BLUE; for (const sx of [-1, 1]) for (const yy of [0, 10]) line(ctx, cx + sx * 62 * s, cy + ey + yy * s, cx + sx * 74 * s, cy + ey + (yy + 8) * s, 5 * s);
    ctx.strokeStyle = DARK; return;
  }
  if (face === 'hot') {
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.lineWidth = 6 * s; ctx.strokeStyle = DARK; ctx.arc(cx + sx * ex, cy + ey + 6 * s, 11 * s, Math.PI, 2 * Math.PI); ctx.stroke(); } // 지친 눈(^)
    const my = cy + 38 * s; circle(ctx, cx, my, 17 * s, { stroke: DARK, w: 6 * s, fill: '#fff' }); // 헥헥 입
    ctx.fillStyle = RED; ctx.beginPath(); ctx.ellipse(cx + 4 * s, my + 8 * s, 8 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill(); // 혀
    // 땀방울
    ctx.fillStyle = BLUE; ctx.beginPath(); ctx.ellipse(cx + 70 * s, cy - 40 * s, 9 * s, 14 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = DARK; return;
  }
  if (face === 'love') {
    // 하트 눈 + 웃는 입
    for (const sx of [-1, 1]) heart(ctx, cx + sx * ex, cy + ey, 13 * s, RED);
    const my = cy + 34 * s; ctx.beginPath(); ctx.lineWidth = 6 * s; ctx.strokeStyle = DARK; ctx.arc(cx, my, 20 * s, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); return;
  }
  if (face === 'cry') {
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.lineWidth = 6 * s; ctx.strokeStyle = DARK; ctx.arc(cx + sx * ex, cy + ey + 8 * s, 11 * s, Math.PI, 2 * Math.PI); ctx.stroke(); ctx.fillStyle = BLUE; ctx.beginPath(); ctx.ellipse(cx + sx * ex, cy + ey + 34 * s, 7 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill(); }
    const my = cy + 40 * s; ctx.beginPath(); ctx.lineWidth = 6 * s; ctx.strokeStyle = DARK; ctx.arc(cx, my + 20 * s, 18 * s, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke(); ctx.fillStyle = DARK; return;
  }
  if (face === 'sleepy') {
    for (const sx of [-1, 1]) line(ctx, cx + sx * ex - 12 * s, cy + ey, cx + sx * ex + 12 * s, cy + ey, 5 * s);
    circle(ctx, cx, cy + 40 * s, 9 * s, { stroke: DARK, w: 5 * s, fill: '#fff' }); return;
  }
  if (face === 'angry') {
    for (const sx of [-1, 1]) eye(cx + sx * ex, cy + ey, 9 * s);
    line(ctx, cx - ex - 16 * s, cy + ey - 22 * s, cx - ex + 14 * s, cy + ey - 8 * s, 7 * s); // \ 눈썹
    line(ctx, cx + ex + 16 * s, cy + ey - 22 * s, cx + ex - 14 * s, cy + ey - 8 * s, 7 * s); // /
    line(ctx, cx - 22 * s, cy + 40 * s, cx + 22 * s, cy + 40 * s, 6 * s); return;
  }
  if (face === 'disgust') {
    line(ctx, cx - ex - 12 * s, cy + ey, cx - ex + 12 * s, cy + ey, 5 * s); // 실눈
    eye(cx + ex, cy + ey, 9 * s);
    const my = cy + 36 * s; ctx.beginPath(); ctx.lineWidth = 6 * s; ctx.strokeStyle = DARK;
    ctx.moveTo(cx - 22 * s, my + 6 * s); ctx.lineTo(cx - 8 * s, my - 4 * s); ctx.lineTo(cx + 6 * s, my + 6 * s); ctx.lineTo(cx + 22 * s, my - 4 * s); ctx.stroke(); return;
  }
  if (face === 'wink') {
    line(ctx, cx - ex - 12 * s, cy + ey, cx - ex + 12 * s, cy + ey, 6 * s); // 감은 눈
    eye(cx + ex, cy + ey, 9 * s);
    const my = cy + 34 * s; ctx.beginPath(); ctx.lineWidth = 6 * s; ctx.strokeStyle = DARK; ctx.arc(cx, my, 20 * s, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); return;
  }
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
  // 입 (방향 반영)
  const my = cy + (dir === 'up' ? 18 : dir === 'down' ? 46 : 34) * s;
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
export function drawMascot(ctx: any, cx: number, cy: number, opts: { pose?: Pose; face?: Face; s?: number; dir?: Dir }) {
  const s = opts.s ?? 2; const pose = opts.pose ?? 'stand'; const lw = 13 * s; const r = 80 * s; const dir: Dir = opts.dir ?? 'front';
  ctx.strokeStyle = DARK; ctx.fillStyle = DARK;
  // 포즈별 머리 위치 보정 + 몸
  const neck = cy + r, hip = neck + 150 * s, sh = neck + 18 * s;
  const L = (x1: number, y1: number, x2: number, y2: number) => line(ctx, x1, y1, x2, y2, lw);
  const legs = () => { L(cx, hip, cx - 45 * s, hip + 95 * s); L(cx, hip, cx + 45 * s, hip + 95 * s); };
  const armsHug = () => { L(cx, sh, cx - 70 * s, sh + 50 * s); L(cx, sh, cx + 70 * s, sh + 50 * s); L(cx - 70 * s, sh + 50 * s, cx - 30 * s, sh + 70 * s); L(cx + 70 * s, sh + 50 * s, cx + 30 * s, sh + 70 * s); };
  const armsDown = () => { L(cx, sh, cx - 60 * s, sh + 60 * s); L(cx, sh, cx + 60 * s, sh + 60 * s); };

  if (pose === 'fall') {
    // 넘어짐: 머리 낮게, 몸 대각, 다리 번쩍
    circle(ctx, cx, cy, r, { stroke: DARK, w: lw, fill: '#fff' }); drawFace(ctx, cx, cy, s, opts.face ?? 'dizzy', dir);
    L(cx + 40 * s, cy + r - 10 * s, cx + 180 * s, hip - 40 * s);       // 몸통 대각
    L(cx + 180 * s, hip - 40 * s, cx + 150 * s, hip - 150 * s); L(cx + 180 * s, hip - 40 * s, cx + 230 * s, hip - 130 * s); // 다리 번쩍
    L(cx + 30 * s, cy + r, cx - 40 * s, cy + r + 70 * s); L(cx + 50 * s, cy + r - 20 * s, cx + 110 * s, cy + r - 60 * s);   // 팔
    return;
  }
  circle(ctx, cx, cy, r, { stroke: DARK, w: lw, fill: '#fff' });
  drawFace(ctx, cx, cy, s, opts.face ?? (pose === 'shiver' ? 'worried' : 'neutral'), dir);
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
  } else if (pose === 'onearm') {
    L(cx, neck, cx, hip); legs(); L(cx, sh, cx - 60 * s, sh + 60 * s); L(cx, sh, cx + 80 * s, sh - 75 * s); // 한 팔 번쩍
  } else if (pose === 'twoarms') {
    L(cx, neck, cx, hip); legs(); L(cx, sh, cx - 80 * s, sh - 75 * s); L(cx, sh, cx + 80 * s, sh - 75 * s); // 두 팔 번쩍
  } else if (pose === 'oneleg') {
    L(cx, neck, cx, hip); armsDown(); L(cx, hip, cx - 40 * s, hip + 95 * s); L(cx, hip, cx + 55 * s, hip + 40 * s); // 한 발만 땅, 한 발 듦
  } else if (pose === 'jump') {
    // 두 팔 들고 뛰기: 다리 굽혀 공중, 팔 번쩍, 발밑 모션
    L(cx, neck, cx, hip); L(cx, sh, cx - 80 * s, sh - 70 * s); L(cx, sh, cx + 80 * s, sh - 70 * s);
    L(cx, hip, cx - 50 * s, hip + 55 * s); L(cx - 50 * s, hip + 55 * s, cx - 30 * s, hip + 100 * s);
    L(cx, hip, cx + 50 * s, hip + 55 * s); L(cx + 50 * s, hip + 55 * s, cx + 30 * s, hip + 100 * s);
    ctx.strokeStyle = GREY; for (const dx of [-70, 0, 70]) line(ctx, cx + dx * s - 20 * s, hip + 150 * s, cx + dx * s + 20 * s, hip + 150 * s, 6 * s); ctx.strokeStyle = DARK;
  } else if (pose === 'run') {
    // 달리기: 몸 약간 기울고 다리 교차, 팔 앞뒤
    L(cx, neck, cx + 15 * s, hip);
    L(cx + 10 * s, sh, cx + 80 * s, sh - 25 * s); L(cx + 10 * s, sh, cx - 55 * s, sh + 55 * s); // 팔 앞뒤
    L(cx + 15 * s, hip, cx + 75 * s, hip + 70 * s); L(cx + 15 * s, hip, cx - 45 * s, hip + 85 * s); // 다리 교차
    ctx.strokeStyle = GREY; for (const yy of [-20, 20]) line(ctx, cx - 110 * s, cy + yy * s, cx - 60 * s, cy + yy * s, 6 * s); ctx.strokeStyle = DARK; // 스피드 라인
  } else if (pose === 'sit') {
    L(cx, neck, cx, hip); armsDown(); L(cx, hip, cx + 70 * s, hip); L(cx + 70 * s, hip, cx + 70 * s, hip + 70 * s); // 앉은 다리(ㄱ)
    L(cx, hip, cx - 30 * s, hip + 5 * s); L(cx - 30 * s, hip + 5 * s, cx - 30 * s, hip + 70 * s);
  } else if (pose === 'liedown') {
    // 눕기: 몸통 수평, 팔다리 편안 (머리 왼쪽)
    L(cx + 30 * s, cy, cx + 250 * s, cy + 30 * s);
    L(cx + 150 * s, cy + 20 * s, cx + 150 * s, cy - 40 * s); L(cx + 250 * s, cy + 30 * s, cx + 300 * s, cy - 20 * s); L(cx + 250 * s, cy + 30 * s, cx + 300 * s, cy + 70 * s);
  } else if (pose === 'clap') {
    L(cx, neck, cx, hip); legs(); L(cx, sh, cx - 55 * s, sh - 20 * s); L(cx, sh, cx + 55 * s, sh - 20 * s); // 두 손 모으기
    for (const d of [30, 55]) { ctx.strokeStyle = GREY; line(ctx, cx - d * s, sh - 55 * s, cx - (d + 20) * s, sh - 70 * s, 4 * s); line(ctx, cx + d * s, sh - 55 * s, cx + (d + 20) * s, sh - 70 * s, 4 * s); } ctx.strokeStyle = DARK;
  } else if (pose === 'thumbsup') {
    L(cx, neck, cx, hip); legs(); L(cx, sh, cx - 60 * s, sh + 55 * s); L(cx, sh, cx + 55 * s, sh + 10 * s); // 팔 접어 엄지
    circle(ctx, cx + 62 * s, sh + 2 * s, 13 * s, { fill: '#fff', stroke: DARK, w: 6 * s }); line(ctx, cx + 62 * s, sh - 10 * s, cx + 62 * s, sh - 30 * s, 9 * s); // 엄지
  } else if (pose === 'nosepinch') {
    L(cx, neck, cx, hip); legs(); L(cx, sh, cx - 60 * s, sh + 55 * s); L(cx, sh, cx + 30 * s, cy + 40 * s); // 한 손 코로
  } else if (pose === 'facepalm') {
    L(cx, neck, cx, hip); legs(); L(cx, sh, cx + 60 * s, sh + 55 * s); L(cx, sh, cx - 20 * s, cy + 10 * s); // 손으로 얼굴
  } else if (pose === 'armscross') {
    L(cx, neck, cx, hip); legs(); L(cx - 55 * s, sh + 35 * s, cx + 55 * s, sh + 15 * s); L(cx + 55 * s, sh + 35 * s, cx - 55 * s, sh + 15 * s); // 팔짱
  } else if (pose === 'wave') {
    L(cx, neck, cx, hip); legs(); L(cx, sh, cx - 60 * s, sh + 55 * s); L(cx, sh, cx + 70 * s, sh - 60 * s); // 손 흔들기
    ctx.strokeStyle = GREY; ctx.beginPath(); ctx.lineWidth = 4 * s; ctx.arc(cx + 90 * s, sh - 75 * s, 22 * s, 1.7 * Math.PI, 2.2 * Math.PI); ctx.stroke(); ctx.strokeStyle = DARK;
  } else { // stand
    L(cx, neck, cx, hip); armsDown(); legs();
  }
}

function drawHearts(ctx: any, cx: number, cy: number, s: number) { for (const [dx, dy, r] of [[0, 0, 16], [40, -30, 11], [-38, -24, 12]]) heart(ctx, cx + dx * s, cy + dy * s, r * s, RED); }
function drawZzz(ctx: any, cx: number, cy: number, s: number) { ctx.fillStyle = GREY; ctx.textAlign = 'left'; [[0, 0, 40], [34, -34, 30], [60, -62, 22]].forEach(([dx, dy, sz]) => { ctx.font = `bold ${Math.round(sz * s)}px KoreanBold, sans-serif`; ctx.fillText('Z', cx + dx * s, cy + dy * s); }); }
function drawCoin(ctx: any, cx: number, cy: number, s: number) { for (const [dx, dy] of [[0, 0], [30, 14], [-26, 10]]) { circle(ctx, cx + dx * s, cy + dy * s, 26 * s, { fill: '#f4c430', stroke: '#c99a1e', w: 5 * s }); ctx.fillStyle = '#a97e12'; ctx.font = `bold ${Math.round(26 * s)}px KoreanBold, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('₩', cx + dx * s, cy + dy * s + 9 * s); ctx.textAlign = 'left'; } }
function drawStink(ctx: any, cx: number, cy: number, s: number) { ctx.strokeStyle = '#7ba05b'; ctx.lineWidth = 5 * s; for (const dx of [-20, 10, 40]) { ctx.beginPath(); for (let k = 0; k < 4; k++) { const yy = cy - k * 22 * s; if (k === 0) ctx.moveTo(cx + dx * s, yy); else ctx.quadraticCurveTo(cx + dx * s + (k % 2 ? 14 : -14) * s, yy + 11 * s, cx + dx * s, yy); } ctx.stroke(); } ctx.strokeStyle = DARK; }
function drawSparkle(ctx: any, cx: number, cy: number, s: number) { ctx.strokeStyle = '#f2b705'; ctx.lineWidth = 5 * s; for (const [dx, dy, r] of [[0, 0, 22], [46, -18, 14], [-42, -14, 16]]) { line(ctx, cx + dx * s - r * s, cy + dy * s, cx + dx * s + r * s, cy + dy * s, 5 * s); line(ctx, cx + dx * s, cy + dy * s - r * s, cx + dx * s, cy + dy * s + r * s, 5 * s); } ctx.strokeStyle = DARK; }
function drawSweat(ctx: any, cx: number, cy: number, s: number) { ctx.fillStyle = BLUE; ctx.beginPath(); ctx.ellipse(cx, cy, 10 * s, 15 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = DARK; }

/** 훅 장면 소품 배치 (마스코트 기준). */
export function drawSceneProps(ctx: any, cx: number, headCy: number, s: number, spec: { prop?: Prop; label?: string; item?: boolean; itemLabel?: string; washer?: boolean; drops?: boolean; mark?: 'qmark' | 'excl' }) {
  const hip = headCy + 80 * s + 150 * s;
  if (spec.washer) drawWasher(ctx, cx + 190 * s, headCy + 180 * s, s);
  if (spec.item) drawItem(ctx, cx + 140 * s, headCy + 150 * s, spec.itemLabel || '', s);
  if (spec.drops) drawDrops(ctx, cx + 30 * s, hip - 10 * s, s);
  if (spec.mark) drawMark(ctx, cx + (spec.mark === 'qmark' ? -20 : 170) * s, headCy - 120 * s, spec.mark, s);
  // 추가 소품 (prop 필드)
  if (spec.prop === 'hearts') drawHearts(ctx, cx + 150 * s, headCy - 40 * s, s);
  else if (spec.prop === 'zzz') drawZzz(ctx, cx + 130 * s, headCy - 100 * s, s);
  else if (spec.prop === 'coin') drawCoin(ctx, cx + 160 * s, headCy + 40 * s, s);
  else if (spec.prop === 'stink') drawStink(ctx, cx + 150 * s, headCy - 10 * s, s);
  else if (spec.prop === 'sparkle') drawSparkle(ctx, cx + 150 * s, headCy - 60 * s, s);
  else if (spec.prop === 'sweat') drawSweat(ctx, cx + 60 * s, headCy - 50 * s, s);
}
