import { NextRequest, NextResponse } from "next/server";
import { geminiImage, toDataUrl, parseDataUrl, GeminiError, GeminiPart } from "@/lib/logomaker/gemini";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_REFS = 4; // 참고 이미지 최대 개수

type Body = {
  brand?: string;
  description?: string; // 무엇을 하는 브랜드인지 / 원하는 이미지
  style?: string; // flat | minimal | emblem | mascot | lettermark
  colors?: string; // 원하는 색상 (자유 텍스트)
  refs?: string[]; // 참고 이미지 (data URL 배열) — 이 스타일을 참고해서 생성
};

const STYLE_HINT: Record<string, string> = {
  flat: "flat vector illustration style, simple bold shapes, solid colors",
  minimal: "extremely minimal, geometric, clean lines, lots of negative space",
  emblem: "emblem / badge style logo, symmetrical, enclosed in a shape",
  mascot: "friendly mascot character logo, cute and approachable",
  lettermark: "monogram / lettermark logo built from the brand initials",
};

function buildPrompt(b: Body, refCount: number): string {
  const brand = (b.brand || "").trim();
  const desc = (b.description || "").trim();
  const style = STYLE_HINT[b.style || "flat"] || STYLE_HINT.flat;
  const colors = (b.colors || "").trim();
  const hasRefs = refCount > 0;

  const lines = [
    hasRefs
      ? `Using the ${refCount} provided reference image(s) as the primary style guide, design a professional company logo${brand ? ` for a brand named "${brand}"` : ""}.`
      : `Design a professional company logo${brand ? ` for a brand named "${brand}"` : ""}.`,
    desc && `Brand / concept: ${desc}.`,
    // 참고 이미지가 있으면 스타일 옵션은 무시하고 참고 이미지의 스타일을 따른다.
    hasRefs
      ? `Match the visual style of the reference image(s) as closely as possible — their kind of shapes, rendering technique, line work, color feeling, level of detail, and overall mood — but produce an original logo for this brand. Do not copy the references exactly. Ignore any other style preset.`
      : `Style: ${style}.`,
    colors && `Preferred colors: ${colors}.`,
    `Square 1:1 composition, centered, on a pure solid white background.`,
    `Modern, high contrast, crisp edges, no photographic texture, no gradients unless subtle.`,
    brand
      ? `You may include the brand name "${brand}" as clean readable text.`
      : `Do not include any text.`,
    `Output a single logo only.`,
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

  const refs = Array.isArray(body.refs) ? body.refs.filter(Boolean).slice(0, MAX_REFS) : [];

  if (!(body.brand || "").trim() && !(body.description || "").trim() && refs.length === 0) {
    return NextResponse.json(
      { error: "브랜드명·설명 또는 참고 이미지를 입력해 주세요." },
      { status: 400 }
    );
  }

  try {
    const parts: GeminiPart[] = [{ text: buildPrompt(body, refs.length) }];
    for (const ref of refs) {
      const { mime, base64 } = parseDataUrl(ref);
      parts.push({ inline_data: { mime_type: mime, data: base64 } });
    }

    const img = await geminiImage(parts);
    return NextResponse.json({ image: toDataUrl(img) });
  } catch (e) {
    const status = e instanceof GeminiError ? e.status : 500;
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status });
  }
}
