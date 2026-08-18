import { NextRequest, NextResponse } from "next/server";
import { geminiImage, toDataUrl, parseDataUrl, GeminiError, GeminiPart } from "@/lib/logomaker/gemini";
import { snapAspectRatio } from "@/lib/logomaker/aspect";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_REFS = 4;

type Body = {
  headline?: string; // 큰 문구
  subtext?: string; // 보조 문구
  description?: string; // 컨셉/배경 설명
  colors?: string;
  width?: number; // 가로 (비율 계산용)
  height?: number; // 세로
  refs?: string[]; // 참고 이미지 (data URL)
};

function buildPrompt(b: Body, ratioLabel: string, refCount: number): string {
  const headline = (b.headline || "").trim();
  const subtext = (b.subtext || "").trim();
  const desc = (b.description || "").trim();
  const colors = (b.colors || "").trim();
  const hasText = !!(headline || subtext);
  const hasRefs = refCount > 0;

  const lines = [
    `Design a professional promotional banner / advertisement graphic with an aspect ratio of exactly ${ratioLabel}.`,
    headline && `Main headline text, large and prominent: "${headline}".`,
    subtext && `Secondary supporting text, smaller: "${subtext}".`,
    desc && `Theme / concept / background: ${desc}.`,
    hasRefs
      ? `Use the ${refCount} provided reference image(s) as the primary visual style guide — match their look, mood, and color feeling. Do not copy them exactly.`
      : null,
    colors && `Preferred colors: ${colors}.`,
    `Balanced, well-composed layout that fills the ${ratioLabel} banner shape, with clear visual hierarchy and comfortable margins around the text.`,
    `Modern, high-contrast, crisp, print-quality. No watermark.`,
    hasText
      ? `Render all text exactly as written, spelled correctly, clearly legible.`
      : `Do not add any text.`,
  ].filter(Boolean);

  return lines.join(" ");
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const hasContent =
    (body.headline || "").trim() ||
    (body.subtext || "").trim() ||
    (body.description || "").trim() ||
    (Array.isArray(body.refs) && body.refs.filter(Boolean).length > 0);
  if (!hasContent) {
    return NextResponse.json(
      { error: "문구·설명 또는 참고 이미지를 입력해 주세요." },
      { status: 400 }
    );
  }

  const w = Number(body.width) > 0 ? Number(body.width) : 16;
  const h = Number(body.height) > 0 ? Number(body.height) : 9;
  const snapped = snapAspectRatio(w, h);

  const refs = Array.isArray(body.refs) ? body.refs.filter(Boolean).slice(0, MAX_REFS) : [];

  try {
    const parts: GeminiPart[] = [{ text: buildPrompt(body, snapped.label, refs.length) }];
    for (const ref of refs) {
      const { mime, base64 } = parseDataUrl(ref);
      parts.push({ inline_data: { mime_type: mime, data: base64 } });
    }

    const img = await geminiImage(parts, { aspectRatio: snapped.label });
    return NextResponse.json({ image: toDataUrl(img), ratio: snapped.label, exact: snapped.exact });
  } catch (e) {
    const status = e instanceof GeminiError ? e.status : 500;
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status });
  }
}
