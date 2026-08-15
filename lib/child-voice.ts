/**
 * 아이 톤(하늘) 전용 혀짧은소리 변환.
 * 오디오(TTS)에만 적용해 발음을 아이처럼 어눌하게 만든다 — 자막·설명은 원문 유지.
 *
 * 중간 강도 = 음절 초성의 ㅅ/ㅆ → ㄸ (예: 소개→또개, 세요→떼요, 상품→땅품).
 * 모음·받침·다른 자음은 건드리지 않아 홍보 내용은 알아들을 수 있게 유지.
 */

// 한글 음절 = 0xAC00 + 초성*588 + 중성*28 + 종성. 초성 인덱스: ㅅ=9, ㅆ=10, ㄸ=4.
const HANGUL_BASE = 0xac00;
const HANGUL_END = 0xd7a3;
const CHO_SPAN = 588;
const CHO_S = 9;   // ㅅ
const CHO_SS = 10; // ㅆ
const CHO_TT = 4;  // ㄸ

/** 중간 강도 혀짧은소리: 초성 ㅅ/ㅆ 를 ㄸ 로 치환 */
export function applyChildLisp(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= HANGUL_BASE && code <= HANGUL_END) {
      const idx = code - HANGUL_BASE;
      const cho = Math.floor(idx / CHO_SPAN);
      if (cho === CHO_S || cho === CHO_SS) {
        out += String.fromCodePoint(HANGUL_BASE + CHO_TT * CHO_SPAN + (idx % CHO_SPAN));
        continue;
      }
    }
    out += ch;
  }
  return out;
}
