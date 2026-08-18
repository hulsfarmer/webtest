// ── Gemini 이미지 생성/편집 (Nano Banana) ─────────────────────────
// generateContent 엔드포인트로 이미지 생성·편집. 결과는 base64 PNG.
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";

export type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

export type GeminiImage = { mime: string; base64: string };

// status 를 담은 에러 (라우트에서 상태코드 매핑용)
export class GeminiError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

export type GeminiImageOpts = {
  aspectRatio?: string; // "16:9" 등 (모델 지원 목록으로 스냅된 값)
};

export async function geminiImage(
  parts: GeminiPart[],
  opts: GeminiImageOpts = {}
): Promise<GeminiImage> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.includes("여기에")) {
    throw new GeminiError("GEMINI_API_KEY 가 설정되지 않았습니다.", 500);
  }

  const generationConfig: Record<string, unknown> = {
    responseModalities: ["TEXT", "IMAGE"],
  };
  if (opts.aspectRatio) {
    generationConfig.imageConfig = { aspectRatio: opts.aspectRatio };
  }

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 400);
    try {
      msg = JSON.parse(text)?.error?.message || msg;
    } catch {
      /* keep raw */
    }
    if (res.status === 429) {
      throw new GeminiError("Gemini 사용량 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.", 429);
    }
    if (res.status === 400 || res.status === 403) {
      throw new GeminiError(`Gemini 인증/요청 오류: ${msg}`, 502);
    }
    throw new GeminiError(`Gemini 오류 (${res.status}): ${msg}`, 502);
  }

  const data = JSON.parse(text);
  const outParts = data?.candidates?.[0]?.content?.parts || [];
  for (const p of outParts) {
    const inline = p.inlineData || p.inline_data;
    if (inline?.data) {
      return {
        mime: inline.mimeType || inline.mime_type || "image/png",
        base64: inline.data,
      };
    }
  }

  // 이미지가 없으면 안전필터 차단이거나 텍스트만 응답한 경우
  const finish = data?.candidates?.[0]?.finishReason;
  const textOut = outParts
    .map((p: { text?: string }) => p.text)
    .filter(Boolean)
    .join(" ");
  if (finish && finish !== "STOP") {
    throw new GeminiError(`이미지가 차단되었습니다 (${finish}). 다른 표현으로 시도해 주세요.`, 502);
  }
  throw new GeminiError(
    textOut ? `이미지가 생성되지 않았습니다: ${textOut.slice(0, 200)}` : "이미지가 생성되지 않았습니다.",
    502
  );
}

export function toDataUrl(img: GeminiImage): string {
  return `data:${img.mime};base64,${img.base64}`;
}

export function parseDataUrl(url: string): { mime: string; base64: string } {
  const m = url.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!m) throw new GeminiError("잘못된 이미지 형식입니다.", 400);
  return { mime: m[1], base64: m[2] };
}
