/**
 * 제품 링크에서 og 메타태그로 제품명·이미지·설명 추출.
 * 쿠팡 등 봇차단 사이트는 fetch 단계에서 막힘 → 엔드포인트에서 안내 처리.
 */

function decodeEntities(s: string): string {
  return (s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .trim();
}

/** 속성 순서(property 먼저 / content 먼저) 양쪽 모두 대응 */
function metaContent(html: string, key: string, attr: 'property' | 'name'): string | undefined {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+${attr}=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*${attr}=["']${k}["']`, 'i'),
  ];
  for (const p of patterns) { const m = html.match(p); if (m) return decodeEntities(m[1]); }
  return undefined;
}

export interface ProductMeta {
  title?: string;
  category?: string;
  description?: string;
  image?: string;
}

const SHOP_SITES = /(쿠팡|네이버쇼핑|스마트스토어|11번가|G마켓|Gmarket|옥션|Auction|위메프|티몬|SSG|무신사|롯데온|인터파크|Coupang)/i;

/** og:title 접미사 정리: "제품 - 카테고리 | 쿠팡" → "제품" */
export function cleanTitle(raw?: string): string {
  let t = (raw || '').trim();
  const parts = t.split(/\s*[|｜]\s*/);
  if (parts.length > 1 && SHOP_SITES.test(parts[parts.length - 1])) {
    parts.pop();
    t = parts.join(' | ').trim();
    // 쿠팡식 "제품 - 카테고리"의 마지막 카테고리 제거 (쉼표 없는 짧은 꼬리)
    t = t.replace(/\s*[-–—]\s*[^-–—,]{1,15}$/, '').trim();
  }
  return t || (raw || '').trim();
}

/** og:title 에서 카테고리 추출: "제품 - 헤어스타일링 | 쿠팡" → "헤어스타일링" */
export function extractCategory(raw?: string): string {
  const t = (raw || '').trim();
  const parts = t.split(/\s*[|｜]\s*/);
  if (parts.length > 1 && SHOP_SITES.test(parts[parts.length - 1])) {
    const body = parts.slice(0, -1).join(' | ');
    const m = body.match(/[-–—]\s*([^-–—,]{1,15})\s*$/);
    if (m) return m[1].trim();
  }
  return '';
}

/** 쿠팡 등의 SEO성 설명(별점·리뷰·"더 저렴하게")인지 — 홍보포인트로 부적합 */
export function isSeoJunkDescription(d?: string): boolean {
  if (!d) return false;
  return /(별점|리뷰\s*\d|후기\s*\d|더\s*저렴|최저가|지금\s*쿠팡|쿠팡에서|무료배송|로켓배송)/.test(d);
}

/** 상세페이지 마케팅 이미지 URL 추출 (쿠팡 subType-IMAGE 등 전체폭 상세 이미지) */
export function extractDetailImages(html: string, baseUrl: string, max = 4): string[] {
  const urls: string[] = [];
  // 쿠팡: <div class="subType-IMAGE..."><img src="...q89/...">
  const re = /subType-IMAGE[^>]*>\s*<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && urls.length < 40) urls.push(m[1]);
  // 일반몰 fallback: 상세영역(product-detail/detail/goods-detail) 안의 큰 이미지
  if (urls.length === 0) {
    const start = html.search(/(product-detail|goods[-_]?detail|detail[-_]?content|prod[-_]?detail)/i);
    if (start >= 0) {
      const seg = html.slice(start, start + 200000);
      const re2 = /<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png))["']/gi;
      while ((m = re2.exec(seg)) && urls.length < 40) urls.push(m[1]);
    }
  }
  const abs = urls.map((u) => {
    if (/^https?:\/\//i.test(u)) return u;
    try { return new URL(u, baseUrl).href; } catch { return ''; }
  }).filter(Boolean);
  // 아이콘/로고/버튼 같은 작은 정적 자산 제외
  const filtered = abs.filter((u) => !/(static\/media|\/badges\/|\/common\/|logo|icon|arrow|btn|button|sprite)/i.test(u));
  return [...new Set(filtered)].slice(0, max);
}

export function extractOgMeta(html: string, baseUrl: string): ProductMeta {
  const title =
    metaContent(html, 'og:title', 'property') ||
    metaContent(html, 'twitter:title', 'name') ||
    html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
  const description =
    metaContent(html, 'og:description', 'property') ||
    metaContent(html, 'twitter:description', 'name') ||
    metaContent(html, 'description', 'name');
  let image =
    metaContent(html, 'og:image', 'property') ||
    metaContent(html, 'og:image:url', 'property') ||
    metaContent(html, 'twitter:image', 'name');
  if (image && !/^https?:\/\//i.test(image)) {
    try { image = new URL(image, baseUrl).href; } catch { image = undefined; }
  }
  const rawTitle = title ? decodeEntities(title) : undefined;
  return {
    title: rawTitle ? cleanTitle(rawTitle) : undefined,
    category: extractCategory(rawTitle),
    description: description ? decodeEntities(description) : undefined,
    image,
  };
}
