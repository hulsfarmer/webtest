/**
 * 제품 이미지 → "그 제품을 든 한국인 프리젠터" 이미지 생성 (Gemini 이미지 모델).
 * 제품홍보영상(AI배우) 전용: 생성 이미지를 VisionStory 아바타로 넣어 말하게 한다.
 * 실제 제품 이미지를 참조(inline)로 넘겨 라벨·형태를 보존한다.
 */
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';

export interface ActorOpts {
  businessName?: string;
  businessType?: string;
  sellingPoints?: string;
  presenter?: string; // "여성" | "남성" 등 (선택). 없으면 모델이 자연스럽게.
  holdProduct?: boolean; // 기본 true. false면 제품을 들지 않고 말만 하는 프리젠터(제품1 저가).
}

/** 제품 버퍼 → 프리젠터 PNG 버퍼(9:16). holdProduct=false면 제품 없이 말하는 배우. 실패 시 throw. */
export async function generateActorHoldingProduct(productBuf: Buffer, opts: ActorOpts = {}): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 가 설정되지 않았습니다.');

  const who = opts.presenter?.trim() || 'a friendly Korean presenter in their late 20s to 30s';
  const ctx = [opts.businessName && `Product: ${opts.businessName}`, opts.businessType && `Category: ${opts.businessType}`]
    .filter(Boolean).join('. ');
  const hold = opts.holdProduct !== false;

  // reqParts: hold=true면 제품 이미지를 참조로 넣어 손에 들게, false면 텍스트만(제품 없이 말하기)
  const reqParts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [];
  let prompt: string;
  if (hold) {
    // 포맷 편차(jpg/webp) 방지 → PNG 정규화 후 전송 (sharp 는 빌드 시 로딩 회피 위해 동적 import)
    const sharp = (await import('sharp')).default;
    const png = await sharp(productBuf).png().toBuffer();
    prompt =
      `You are given a product image. Create a photorealistic vertical 9:16 UGC-style advertising photo. ` +
      `${who} stands in a bright, clean, well-lit room with soft natural light, facing the camera with a warm, natural smile. ` +
      `Upper body visible, clear well-lit face. The presenter holds THIS EXACT product up near the chest, showing it clearly to the viewer. ` +
      `Preserve the product's exact shape, color, label and text — do not redesign or alter the product in any way. ` +
      `Sharp focus, natural skin texture, realistic. No text overlays, no captions, no watermarks, no extra logos. ` +
      (ctx ? `Context: ${ctx}.` : '');
    reqParts.push({ text: prompt }, { inline_data: { mime_type: 'image/png', data: png.toString('base64') } });
  } else {
    prompt =
      `Create a photorealistic vertical 9:16 UGC-style advertising photo. ` +
      `${who} stands in a bright, clean, well-lit room with soft natural light, facing the camera with a warm, natural smile, speaking to the viewer as if presenting. ` +
      `Upper body visible, clear well-lit face, hands relaxed and natural — NOT holding any product or object. ` +
      `Sharp focus, natural skin texture, realistic. No text overlays, no captions, no watermarks, no logos. ` +
      (ctx ? `Context: ${ctx}.` : '');
    reqParts.push({ text: prompt });
  }

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: reqParts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '9:16' } },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`제품 배우 이미지 생성 실패 (${res.status}): ${text.slice(0, 300)}`);

  const data = JSON.parse(text);
  const parts = data?.candidates?.[0]?.content?.parts || [];
  for (const p of parts) {
    const inl = p.inlineData || p.inline_data;
    if (inl?.data) return Buffer.from(inl.data, 'base64');
  }
  throw new Error('제품 배우 이미지 생성 응답에 이미지가 없습니다.');
}
