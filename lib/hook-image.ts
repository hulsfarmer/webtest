// lib/hook-image.ts
// 훅 장면 AI 일러스트 생성 (Gemini image). 첫 장면을 레퍼런스로 다음 장면을 생성해
// 한 영상 안에서 같은 캐릭터를 유지한다. (훅=연출이라 성능주장 아님)
import fs from 'fs';
import path from 'path';

const MODEL = 'gemini-3-pro-image-preview';
const STYLE =
  'Cute minimal 2D flat vector illustration. One small round friendly original mascot character. ' +
  'Soft muted colors, thick rounded dark outlines, simple shapes. Solid warm cream ivory background (#F4F0E8). ' +
  'Vertical 9:16 tall composition, character centered in the lower-middle, generous empty space in the upper third. No text, no words.';

/** 훅 장면 프롬프트들 → 일러스트 PNG 경로들 (1장면 레퍼런스로 일관성 유지) */
export async function generateHookImages(prompts: string[], workDir: string): Promise<string[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 없음');
  const out: string[] = [];
  let refData: string | null = null;

  for (let i = 0; i < prompts.length; i++) {
    const parts: Record<string, unknown>[] = [];
    if (refData) parts.push({ inlineData: { mimeType: 'image/png', data: refData } });
    const text = refData
      ? `Use the EXACT same character, same flat illustration style, same cream ivory background as the reference image. ${prompts[i]} Vertical 9:16, empty space in the upper third, no text.`
      : `${STYLE} ${prompts[i]}`;
    parts.push({ text });

    const body = { contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'] } };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await r.json();
    const part = (d?.candidates?.[0]?.content?.parts || []).find((p: { inlineData?: unknown }) => p.inlineData) as
      | { inlineData: { data: string } } | undefined;
    if (!part) throw new Error(`훅 이미지 생성 실패(${i}): ${JSON.stringify(d).slice(0, 200)}`);
    const fp = path.join(workDir, `hookimg_${i}.png`);
    fs.writeFileSync(fp, Buffer.from(part.inlineData.data, 'base64'));
    out.push(fp);
    if (i === 0) refData = part.inlineData.data; // 첫 장면을 레퍼런스로
  }
  return out;
}
