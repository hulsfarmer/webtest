import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { geminiImage, toDataUrl, parseDataUrl, GeminiError } from "@/lib/logomaker/gemini";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  image?: string; // 현재 로고 (data URL)
  instruction?: string; // 수정 지시 (예: "잎사귀만 파란색으로")
  context?: string; // 지켜야 할 제약 (예: 유튜브 배너 안전영역) — 선택
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ?? (process.env.NODE_ENV !== "production" ? "dev-local" : null);
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const image = body.image || "";
  const instruction = (body.instruction || "").trim();
  if (!image || !instruction) {
    return NextResponse.json(
      { error: "수정할 이미지와 수정 내용이 필요합니다." },
      { status: 400 }
    );
  }

  const context = (body.context || "").trim();

  try {
    const { mime, base64 } = parseDataUrl(image);
    // 요청한 변경은 반드시 수행하되, 언급 안 한 부분만 유지하도록.
    // (이전 프롬프트는 "텍스트 포함 전부 동일하게"라고 못박아 글자 수정을 무시하던 문제가 있었음)
    // context(예: 유튜브 배너 안전영역)는 지시를 방해하지 않도록 뒤쪽 제약으로 둔다.
    const prompt =
      `You are editing the provided image. Make this change and make it clearly visible: ${instruction}. ` +
      `Fully perform the requested change even if it affects the text, its size, position, wording, or color. ` +
      `Leave the parts of the image that the instruction does not mention as close to the original as possible; ` +
      `do not restyle or redraw unrelated areas.` +
      (context ? ` While making the change, also keep this layout constraint: ${context}` : "");

    const img = await geminiImage([
      { text: prompt },
      { inline_data: { mime_type: mime, data: base64 } },
    ]);
    return NextResponse.json({ image: toDataUrl(img) });
  } catch (e) {
    const status = e instanceof GeminiError ? e.status : 500;
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status });
  }
}
