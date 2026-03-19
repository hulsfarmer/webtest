import { NextRequest, NextResponse } from 'next/server';

// POST: Convert any image to JPEG via sharp (for mobile compatibility)
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('image') as File | null;
    if (!file || !(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    // Limit to 20MB
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image too large' }, { status: 400 });
    }

    const sharp = (await import('sharp')).default;
    const buffer = Buffer.from(await file.arrayBuffer());

    const jpegBuffer = await sharp(buffer)
      .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    return new NextResponse(new Uint8Array(jpegBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(jpegBuffer.length),
      },
    });
  } catch (err) {
    console.error('[Convert] Image conversion failed:', err);
    return NextResponse.json({ error: 'Conversion failed' }, { status: 500 });
  }
}
