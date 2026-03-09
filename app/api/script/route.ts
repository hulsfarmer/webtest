import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { generateScript, generateScriptFromImages } from '@/lib/anthropic';

function getUploadedImagePaths(uploadId: string): string[] {
  const uploadDir = path.join(process.cwd(), 'data', 'uploads', uploadId);
  if (!fs.existsSync(uploadDir)) return [];
  return fs.readdirSync(uploadDir)
    .filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f))
    .sort()
    .map(f => path.join(uploadDir, f));
}

/** Script-only generation — no audio/video, no job, no usage decrement.
 *  Used for the script preview step so the user can review/edit before committing. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { topic, duration = 60, tone = '정보성', uploadId } = body;

  if (!topic || typeof topic !== 'string' || !topic.trim()) {
    return NextResponse.json({ error: '주제를 입력해주세요.' }, { status: 400 });
  }

  try {
    let script;
    if (uploadId) {
      const imagePaths = getUploadedImagePaths(uploadId);
      if (imagePaths.length > 0) {
        script = await generateScriptFromImages(imagePaths, topic.trim(), duration, tone);
      } else {
        script = await generateScript(topic.trim(), duration, tone);
      }
    } else {
      script = await generateScript(topic.trim(), duration, tone);
    }
    return NextResponse.json({ script });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
