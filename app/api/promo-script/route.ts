import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { generatePromoScript, generatePromoScriptFromImages, PromoInput } from '@/lib/anthropic';

function getUploadedImagePaths(uploadId: string): string[] {
  const uploadDir = path.join(process.cwd(), 'data', 'uploads', uploadId);
  if (!fs.existsSync(uploadDir)) return [];
  return fs.readdirSync(uploadDir)
    .filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f))
    .sort()
    .map(f => path.join(uploadDir, f));
}

/** Promo script-only generation — no audio/video, no job, no usage decrement. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { businessName, businessType, sellingPoints, contact, location, cta, duration = 60, tone = '친근한', uploadId } = body;

  if (!businessName?.trim()) return NextResponse.json({ error: '업체명을 입력해주세요.' }, { status: 400 });
  if (!businessType?.trim()) return NextResponse.json({ error: '업종을 선택해주세요.' }, { status: 400 });
  if (!sellingPoints?.trim()) return NextResponse.json({ error: '홍보 포인트를 입력해주세요.' }, { status: 400 });

  const input: PromoInput = {
    businessName: businessName.trim(),
    businessType: businessType.trim(),
    sellingPoints: sellingPoints.trim(),
    contact: contact?.trim() || undefined,
    location: location?.trim() || undefined,
    cta: cta?.trim() || undefined,
    duration,
    tone,
  };

  try {
    let script;
    if (uploadId) {
      const imagePaths = getUploadedImagePaths(uploadId);
      if (imagePaths.length > 0) {
        script = await generatePromoScriptFromImages(imagePaths, input);
      } else {
        script = await generatePromoScript(input);
      }
    } else {
      script = await generatePromoScript(input);
    }
    return NextResponse.json({ script });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
