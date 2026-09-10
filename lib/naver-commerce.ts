/**
 * 네이버 커머스 API (스마트스토어 판매자 API) 연동.
 * - 내 스토어 상품 URL(/products/{채널상품번호})을 붙이면 상품번호로 정확히 조회한다.
 * - 인증: client_id + timestamp(ms) 를 bcrypt(salt=client_secret) 서명 → base64 → 토큰 발급.
 *   (검색 쇼핑 API 는 신규 발급이 막혀 대신 커머스 API 사용)
 * 키: NAVER_COMMERCE_CLIENT_ID / NAVER_COMMERCE_CLIENT_SECRET
 */
import bcrypt from 'bcryptjs';

const BASE = 'https://api.commerce.naver.com/external';

/** 네이버 스마트스토어/브랜드스토어 상품 URL 여부 */
export function isNaverStoreUrl(url: string): boolean {
  return /(^|\/\/)([\w-]+\.)?(smartstore|brand|shopping)\.naver\.com/i.test(url);
}

/** URL 에서 채널상품번호 추출: .../products/12345 */
export function extractChannelProductNo(url: string): string | null {
  const m = url.match(/\/products\/(\d+)/);
  return m ? m[1] : null;
}

// 발급 토큰 캐시 (기본 만료 ~3시간). 만료 1분 전이면 재발급.
let cachedToken: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.exp > now + 60_000) return cachedToken.token;

  const clientId = process.env.NAVER_COMMERCE_CLIENT_ID;
  const clientSecret = process.env.NAVER_COMMERCE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('네이버 커머스 API 키(NAVER_COMMERCE_CLIENT_ID/SECRET)가 설정되지 않았어요.');
  }

  // 서버-네이버 시계 오차 방어용으로 3초 뺀 timestamp(ms)
  const timestamp = String(now - 3000);
  // password = clientId_timestamp, salt = clientSecret(그 자체가 bcrypt salt 형식)
  const hashed = bcrypt.hashSync(`${clientId}_${timestamp}`, clientSecret);
  const sign = Buffer.from(hashed, 'utf-8').toString('base64');

  const body = new URLSearchParams({
    client_id: clientId,
    timestamp,
    client_secret_sign: sign,
    grant_type: 'client_credentials',
    type: 'SELF',
  });

  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    throw new Error(`네이버 토큰 발급 실패 (HTTP ${r.status}): ${d.message || d.error || '알 수 없는 오류'}`);
  }
  cachedToken = { token: d.access_token, exp: now + (Number(d.expires_in) || 10800) * 1000 };
  return cachedToken.token;
}

export interface NaverProduct {
  title: string;
  category: string;
  description: string;   // 커머스 API 는 짧은 홍보문구 필드가 없어 기본 '' (상세이미지 비전 추출로 보완)
  image: string;         // 대표 이미지 URL
  detailImages: string[];// 상세페이지 이미지 URL (비전 추출용, 최대 3개)
  price?: number;
}

/** 스마트스토어 상품 URL → 커머스 API 로 제품 정보 조회 */
export async function fetchNaverProduct(url: string): Promise<NaverProduct> {
  const no = extractChannelProductNo(url);
  if (!no) throw new Error('네이버 스마트스토어 상품 URL(.../products/숫자)이 아니에요.');

  const token = await getAccessToken();
  const r = await fetch(`${BASE}/v2/products/channel-products/${no}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`네이버 상품 조회 실패 (HTTP ${r.status}): ${d.message || d.error || ''}`);
  }

  const op = d.originProduct ?? {};
  const images = op.images ?? {};
  const rep: string = images.representativeImage?.url ?? '';
  const optional: string[] = Array.isArray(images.optionalImages)
    ? images.optionalImages.map((i: { url?: string }) => i?.url).filter((u: string | undefined): u is string => !!u)
    : [];

  // 상세 설명 HTML 에서 이미지 URL 추출 → 비전 추출용 (스펙/특징 이미지)
  const detailHtml: string = op.detailContent || '';
  const detailImgs = [...detailHtml.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)]
    .map((m) => m[1])
    .filter((u: string) => /^https?:\/\//i.test(u));

  // 카테고리: "A>B>C" 형태면 말단만
  const whole: string = op.wholeCategoryName || '';
  const category = whole.includes('>') ? whole.split('>').pop()!.trim() : whole.trim();

  const detailImages = (detailImgs.length ? detailImgs : [rep]).filter(Boolean).slice(0, 3);

  return {
    title: op.name || '',
    category,
    description: '',
    image: rep,
    detailImages,
    price: typeof op.salePrice === 'number' ? op.salePrice : undefined,
  };
}
