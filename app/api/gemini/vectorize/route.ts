import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parseDataUrl, GeminiError } from "@/lib/logomaker/gemini";

export const runtime = "nodejs";
export const maxDuration = 120;

const VECTORIZE_URL = "https://external.api.recraft.ai/v1/images/vectorize";

type Body = { image?: string }; // 현재 로고 (data URL)

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ?? (process.env.NODE_ENV !== "production" ? "dev-local" : null);
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const token = process.env.RECRAFT_API_TOKEN;
  if (!token || token.includes("여기에")) {
    return NextResponse.json(
      { error: "RECRAFT_API_TOKEN 이 설정되지 않았습니다." },
      { status: 500 }
    );
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  if (!body.image) {
    return NextResponse.json({ error: "벡터화할 이미지가 필요합니다." }, { status: 400 });
  }

  try {
    const { mime, base64 } = parseDataUrl(body.image);
    const bytes = Buffer.from(base64, "base64");
    const ext = mime.includes("png") ? "png" : "jpg";

    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), `logo.${ext}`);
    fd.append("response_format", "url");

    const res = await fetch(VECTORIZE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const text = await res.text();
    if (!res.ok) {
      if (/not_enough_credits/i.test(text)) {
        return NextResponse.json(
          { error: "Recraft 크레딧이 부족합니다. 충전 후 다시 시도해 주세요." },
          { status: 402 }
        );
      }
      return NextResponse.json(
        { error: `벡터화 오류 (${res.status}): ${text.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const data = JSON.parse(text);
    const url: string | undefined = data.image?.url || data.data?.[0]?.url;
    if (!url) {
      return NextResponse.json({ error: "벡터화 결과가 비어 있습니다." }, { status: 502 });
    }

    const svg = await (await fetch(url)).text();
    return NextResponse.json({ svg });
  } catch (e) {
    const status = e instanceof GeminiError ? e.status : 500;
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `벡터화 중 오류: ${msg}` }, { status });
  }
}
