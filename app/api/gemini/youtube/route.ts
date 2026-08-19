import { NextRequest, NextResponse } from "next/server";
import { adminGuard } from "@/lib/admin-guard";
import { geminiImage, toDataUrl, parseDataUrl, GeminiError, GeminiPart } from "@/lib/logomaker/gemini";
import { BANNER_SAFE_AREA_GUIDANCE } from "@/lib/logomaker/youtube";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_REFS = 4;

type Kind = "banner" | "profile";

type Body = {
  kind?: Kind;
  headline?: string; // 채널 이름
  subtext?: string; // 태그라인/보조 문구 (배너)
  description?: string; // 컨셉/배경 설명
  colors?: string;
  refs?: string[]; // 참고 이미지 (data URL)
  style?: string; // 프로필 스타일: mascot | emblem | minimal | lettermark
};

// 프로필 스타일 옵션 — 사용자가 고른다.
const PROFILE_STYLE: Record<string, { hint: string; mono: boolean }> = {
  mascot: {
    hint:
      "a friendly, cute mascot character with a clear face or expression related to the theme; approachable and memorable, with bold simple features that stay recognizable at very small sizes",
    mono: false,
  },
  emblem: {
    hint: "a clean emblem / badge symbol, symmetrical, iconic and centered",
    mono: false,
  },
  minimal: {
    hint:
      "an extremely minimal, flat, modern icon made of simple geometric shapes with generous negative space",
    mono: false,
  },
  lettermark: {
    hint: "a bold monogram / lettermark built from the channel's initials, strong, simple and centered",
    mono: true,
  },
};

// 유튜브 배너: 2048x1152(16:9). 글자 없는 "배경 아트"만 생성한다.
// 채널명·태그라인은 클라이언트가 안전영역 안에 코드로 정확히 합성하므로 여기서 글자는 그리지 않는다.
function bannerPrompt(b: Body, refCount: number): string {
  const desc = (b.description || "").trim();
  const colors = (b.colors || "").trim();

  const lines = [
    `Design a professional YouTube channel banner BACKGROUND artwork, aspect ratio exactly 16:9 for a 2048x1152 image. Do NOT render any text, letters, words, numbers or written logos — background artwork only.`,
    `SAFE AREA for graphics: ${BANNER_SAFE_AREA_GUIDANCE}`,
    `A channel title will later be overlaid across the vertical centre. Therefore keep a calm, relatively uncluttered horizontal band across the centre (about the middle 60% of width and middle 35% of height) with even, controlled brightness and no busy detail or bright highlights there, so overlaid text stays perfectly readable. Put the richer detail and focal elements toward the upper region and the left/right sides, away from the exact centre.`,
    desc && `Theme / concept / mood: ${desc}.`,
    refCount > 0
      ? `Use the ${refCount} provided reference image(s) as the primary visual style guide — match their look, mood and colors. Do not copy them exactly.`
      : null,
    colors && `Preferred colors: ${colors}.`,
    `Wide cinematic composition; the artwork fills the entire 16:9 frame edge to edge and stays visually balanced when the sides are cropped. High-contrast, crisp, modern, professional. No watermark, no UI, no mockup frames, and absolutely no text.`,
  ].filter(Boolean);

  return lines.join(" ");
}

// 유튜브 프로필: 정사각 1:1, 원형으로 표시됨. 로고 엔진과 동일한 접근.
function profilePrompt(b: Body, refCount: number, style: string): string {
  const headline = (b.headline || "").trim();
  const desc = (b.description || "").trim();
  const colors = (b.colors || "").trim();
  const st = PROFILE_STYLE[style] || PROFILE_STYLE.mascot;

  const lines = [
    `Design a professional YouTube channel profile picture / avatar, square 1:1 composition.`,
    `Style: ${st.hint}.`,
    `It is displayed inside a CIRCLE — keep the single main subject centered and large, with comfortable margin, and nothing important in the corners (they are clipped by the circular crop). It must stay clear and instantly recognizable at very small sizes (like an app icon).`,
    headline ? `Brand / channel: "${headline}".` : null,
    desc && `Subject / concept: ${desc}.`,
    refCount > 0
      ? `Use the ${refCount} provided reference image(s) as the primary style guide — match their look, shapes and colors, but produce an original icon. Do not copy them exactly.`
      : null,
    colors && `Preferred colors: ${colors}.`,
    `Strong silhouette, high contrast, clean centered background. No watermark.`,
    st.mono && headline
      ? `You may include a short monogram of 1–2 letters from the channel initials, bold and legible. Do not add any other text.`
      : `Do not include any text or lettering.`,
  ].filter(Boolean);

  return lines.join(" ");
}

export async function POST(req: NextRequest) {
  const _denied = await adminGuard();
  if (_denied) return _denied;
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const kind: Kind = body.kind === "profile" ? "profile" : "banner";
  const refs = Array.isArray(body.refs) ? body.refs.filter(Boolean).slice(0, MAX_REFS) : [];

  const hasContent =
    (body.headline || "").trim() ||
    (body.subtext || "").trim() ||
    (body.description || "").trim() ||
    refs.length > 0;
  if (!hasContent) {
    return NextResponse.json(
      { error: "채널 이름·설명 또는 참고 이미지를 입력해 주세요." },
      { status: 400 }
    );
  }

  const aspectRatio = kind === "profile" ? "1:1" : "16:9";
  const prompt =
    kind === "profile"
      ? profilePrompt(body, refs.length, (body.style || "mascot").trim())
      : bannerPrompt(body, refs.length);

  try {
    const parts: GeminiPart[] = [{ text: prompt }];
    for (const ref of refs) {
      const { mime, base64 } = parseDataUrl(ref);
      parts.push({ inline_data: { mime_type: mime, data: base64 } });
    }

    const img = await geminiImage(parts, { aspectRatio });
    return NextResponse.json({ image: toDataUrl(img), kind, ratio: aspectRatio });
  } catch (e) {
    const status = e instanceof GeminiError ? e.status : 500;
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status });
  }
}
