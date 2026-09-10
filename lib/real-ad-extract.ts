// lib/real-ad-extract.ts
// 상세페이지 HTML → 홍보 이미지 URL + 텍스트 추출 (배너·법적고지 제외).

// 제외 대상: 도매 배너, 개인정보/위탁판매/보호책임자 아이콘, notice 류
const EXCLUDE_IMG = [
  /domeggook\.com/i,
  /icon0?1\.png/i,
  /\/notice/i,
  /bane\d/i,
  /1788906795823bXyW1/i, // 보호책임자 아이콘(반복 등장)
];

/** HTML 에서 img src 추출 → 홍보 이미지만 (중복·배너·고지 제외, 순서 유지) */
export function extractImages(html: string): string[] {
  const urls = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1].trim());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (!/^https?:\/\//i.test(u)) continue;
    if (EXCLUDE_IMG.some((re) => re.test(u))) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

/** HTML 에서 사람이 쓴 홍보 텍스트 추출 (태그 제거, 법적고지 블록 제외) */
export function extractTexts(html: string): string[] {
  // 개인정보/위탁판매 고지 카드부터 뒤는 잘라냄 (법적고지 영역)
  const cut = html.search(/개인정보 제공 동의|위탁판매|개인정보 보호책임자/);
  const body = cut > 0 ? html.slice(0, cut) : html;
  const texts = [...body.matchAll(/<(?:h\d|p|span|strong|li|div)[^>]*>([^<]{2,})<\/(?:h\d|p|span|strong|li|div)>/gi)]
    .map((m) => m[1].replace(/&middot;/g, '·').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length >= 2 && !/^[\s·|]+$/.test(t));
  // 중복 제거
  return [...new Set(texts)];
}

export interface ExtractResult {
  images: string[];
  texts: string[];
}

export function extractFromHtml(html: string): ExtractResult {
  return { images: extractImages(html), texts: extractTexts(html) };
}
