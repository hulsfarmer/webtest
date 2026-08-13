/**
 * 쇼핑몰 상세페이지 이미지 → Claude(멀티모달)가 읽어 홍보 포인트 추출.
 * 상세 이미지는 매우 길어서(예: 1080x3586) 그대로 보내면 글자가 안 읽힘 → 세로 타일로 분할해 전송.
 */
import Anthropic from '@anthropic-ai/sdk';

const MAX_TILES = 6;

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal }).finally(() => clearTimeout(t));
    if (!r.ok) return null;
    if (!(r.headers.get('content-type') || '').startsWith('image/')) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
}

/** 긴 이미지를 폭 1024 기준 세로 타일(약 1024x1230)로 분할, base64 반환 */
async function toTiles(buf: Buffer, maxTiles: number): Promise<string[]> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  let img;
  try { img = await loadImage(buf); } catch { return []; }
  const W = img.width, H = img.height;
  if (!W || !H) return [];
  const outW = Math.min(W, 1024);
  const scale = outW / W;
  const srcTileH = Math.round(W * 1.2);
  const tiles: string[] = [];
  for (let y = 0; y < H && tiles.length < maxTiles; y += srcTileH) {
    const h = Math.min(srcTileH, H - y);
    if (h < W * 0.15) break; // 자투리 무시
    const c = createCanvas(outW, Math.round(h * scale));
    c.getContext('2d').drawImage(img, 0, y, W, h, 0, 0, outW, Math.round(h * scale));
    tiles.push(c.toBuffer('image/jpeg').toString('base64'));
  }
  return tiles;
}

export async function extractSellingPointsFromImages(imageUrls: string[], productName: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY || !imageUrls.length) return '';
  const tiles: string[] = [];
  for (const url of imageUrls) {
    if (tiles.length >= MAX_TILES) break;
    const buf = await fetchImage(url);
    if (!buf) continue;
    tiles.push(...await toTiles(buf, MAX_TILES - tiles.length));
  }
  if (!tiles.length) return '';

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // SDK 버전 간 타입명 차이(ContentBlockParam 등)를 피하려 구조적 타입 사용
  type Block =
    | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg'; data: string } }
    | { type: 'text'; text: string };
  const content: Block[] = [
    ...tiles.map((data): Block => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })),
    {
      type: 'text',
      text: `위 이미지들은 제품 "${productName}"의 쇼핑몰 상세페이지입니다. 홍보 영상에 쓸 핵심 홍보 포인트(효과·성분·특징·차별점·사용법)를 한국어로 3~5개, 각 한 줄로 간결하게 뽑아주세요. 이미지에 실제로 있는 내용만 쓰고 없으면 지어내지 마세요. 불릿기호나 번호 없이 문장만 줄바꿈으로 구분해 출력하세요.`,
    },
  ];
  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: content as any }],
    });
    return (msg.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === 'text')
      .map((b) => b.text || '').join('\n').trim();
  } catch {
    return '';
  }
}
