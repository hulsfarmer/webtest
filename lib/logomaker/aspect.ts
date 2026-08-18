// Gemini 이미지 모델(gemini-3.1-flash-image)이 지원하는 aspect ratio 목록.
// 목록에 없는 비율을 넘기면 400 에러가 나므로, 사용자가 입력한 크기를
// 가장 가까운 지원 비율로 스냅한다.
export const SUPPORTED_RATIOS: { label: string; value: number }[] = [
  { label: "1:8", value: 1 / 8 },
  { label: "1:4", value: 1 / 4 },
  { label: "9:16", value: 9 / 16 },
  { label: "2:3", value: 2 / 3 },
  { label: "3:4", value: 3 / 4 },
  { label: "4:5", value: 4 / 5 },
  { label: "1:1", value: 1 },
  { label: "5:4", value: 5 / 4 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "16:9", value: 16 / 9 },
  { label: "21:9", value: 21 / 9 },
  { label: "4:1", value: 4 },
  { label: "8:1", value: 8 },
];

export type SnappedRatio = {
  label: string; // 예: "16:9"
  value: number; // 예: 1.778
  exact: boolean; // 입력 비율이 지원 목록과 (거의) 일치하는지
};

// 가로 w, 세로 h → 가장 가까운 지원 비율(로그 공간 최근접).
export function snapAspectRatio(w: number, h: number): SnappedRatio {
  const safeW = w > 0 ? w : 1;
  const safeH = h > 0 ? h : 1;
  const r = safeW / safeH;
  const target = Math.log(r);
  let best = SUPPORTED_RATIOS[0];
  let bestDist = Infinity;
  for (const cand of SUPPORTED_RATIOS) {
    const d = Math.abs(Math.log(cand.value) - target);
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  return { label: best.label, value: best.value, exact: bestDist < 0.02 };
}

// 자주 쓰는 배너 프리셋 (px 값 — 비율 계산에만 사용)
export const BANNER_PRESETS: { name: string; w: number; h: number; hint: string }[] = [
  { name: "가로 현수막", w: 1200, h: 300, hint: "4:1" },
  { name: "초와이드 배너", w: 1200, h: 150, hint: "8:1 웹 리더보드" },
  { name: "와이드 (16:9)", w: 1280, h: 720, hint: "발표·썸네일" },
  { name: "정사각 (SNS)", w: 1000, h: 1000, hint: "1:1 인스타" },
  { name: "세로 배너", w: 300, h: 1200, hint: "1:4 현수막 세로" },
  { name: "세로형 (9:16)", w: 720, h: 1280, hint: "스토리·릴스" },
];
