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
  description?: string;
  image?: string;
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
  return {
    title: title ? decodeEntities(title) : undefined,
    description: description ? decodeEntities(description) : undefined,
    image,
  };
}
