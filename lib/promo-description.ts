/**
 * 유튜브 설명란 문자열 생성 (promo-character 공용).
 * 순서: 나레이션 → 구매 링크 → 쿠팡 파트너스 고지 → 제작 크레딧
 */
export function buildPromoDescription(narration: string, buyLink: string): string {
  const n = (narration || '').replace(/[*#`_~]/g, '').replace(/[ \t]+/g, ' ').trim();
  const link = (buyLink || '').trim();
  const lines: string[] = [];
  if (n) lines.push(n);
  if (link) {
    lines.push('', `🛒 구매하기 👉 ${link}`);
    lines.push('', '이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.');
  }
  lines.push('', '🎬 제작: 이지온', '📩 AI영상제작문의: huls_family@naver.com (이지온)');
  return lines.join('\n');
}
