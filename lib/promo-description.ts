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
    lines.push('', `👀 살펴보기 👉 ${link}`);
    lines.push('', '이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.');
  }
  lines.push('', '🎬 제작: 이지온 (EasyOn)', '📩 홍보영상 제작문의: huls_family@naver.com · shortsai.kr');
  return lines.join('\n');
}

/**
 * 인스타 릴스 캡션 = 나레이션 + 이지온 제작·문의 + 해시태그.
 * 유튜브 설명(buildPromoDescription)에 IG 발견용 해시태그 줄을 덧붙인다.
 */
export function buildInstagramCaption(narration: string, buyLink: string, businessName = '', catchphrase = ''): string {
  const base = buildPromoDescription(narration, buyLink);
  const tags = buildYouTubeTags(businessName, catchphrase, narration);
  const hashtags = tags.slice(0, 12).map((t) => '#' + t.replace(/[#\s]/g, '')).filter((h) => h.length > 1);
  return hashtags.length ? `${base}\n\n${hashtags.join(' ')}` : base;
}

// 흔한 조사/어미·의미 약한 단어 (태그 잡음 제거용)
const TAG_STOPWORDS = new Set([
  '그리고', '하지만', '그래서', '지금', '바로', '정말', '너무', '매우', '아주', '더욱', '우리', '저희',
  '이제', '오늘', '여러분', '당신', '당신의', '모든', '다양한', '같은', '이런', '그런', '무엇', '어떤',
  '합니다', '입니다', '드립니다', '해요', '이에요', '예요', '있어요', '있는', '하는', '되는', '수준',
  '완성', '경험', '선물', '만나', '지금까지', '이렇게', '함께', '바로바로',
]);

/**
 * 유튜브 태그(키워드) 자동 생성 — 업체명 + 캐치프레이즈·나레이션 핵심어 + 기본 홍보 태그.
 * 스크래핑/AI 없이 저장된 메타만으로 만든다(무료·즉시). 최대 15개.
 */
export function buildYouTubeTags(businessName: string, catchphrase: string, narration: string, extra: string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw?: string) => {
    const v = (raw || '').replace(/[#*_`~]/g, '').replace(/[.,!?…·]/g, '').trim();
    if (!v || v.length < 2 || v.length > 30 || out.length >= 15) return;
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key); out.push(v);
  };

  add(businessName);

  // 캐치프레이즈 + 나레이션에서 핵심어 빈도 추출
  const words = `${catchphrase} ${narration}`
    .replace(/[^가-힣a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/).filter(Boolean);
  const freq = new Map<string, number>();
  for (let w of words) {
    w = w.replace(/(으로|에서|에게|한테|까지|부터|이나|처럼|보다|마다|만큼|을|를|이|가|은|는|에|의|와|과|도|로)$/, '');
    // 동사·형용사·인사말 등 어미로 끝나면 태그 부적합 → 제외
    if (/(다|요|죠|네|게|서|면|고|며|자|까|니|해|와|줘|봐)$/.test(w)) continue;
    if (w.length < 2 || TAG_STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  const ranked = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map((e) => e[0]);
  for (const w of ranked.slice(0, 7)) add(w);

  for (const e of extra) add(e);
  // 기본 홍보/쇼츠 태그
  ['쇼츠', 'shorts', '홍보영상', '광고', '브랜드홍보', 'AI영상'].forEach(add);
  return out.slice(0, 15);
}
