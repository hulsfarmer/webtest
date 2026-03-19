import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';

const HEIC_EXTENSIONS = new Set(['heic', 'heif']);

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const uploadId = (formData.get('uploadId') as string) || uuidv4();
    const files = formData.getAll('images') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });
    }

    const uploadDir = path.join(process.cwd(), 'data', 'uploads', uploadId);
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const savedPaths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const buffer = Buffer.from(await file.arrayBuffer());

      // Convert HEIC/HEIF to JPEG using sharp
      if (HEIC_EXTENSIONS.has(ext)) {
        const filename = `img_${i}.jpg`;
        const filePath = path.join(uploadDir, filename);
        try {
          await sharp(buffer)
            .jpeg({ quality: 90 })
            .toFile(filePath);
          console.log(`[Upload] Converted HEIC → JPEG: ${file.name}`);
        } catch (err) {
          // If sharp can't handle it, save as-is and hope ffmpeg manages
          console.warn(`[Upload] HEIC conversion failed for ${file.name}:`, err);
          fs.writeFileSync(filePath, buffer);
        }
        savedPaths.push(filePath);
      } else {
        const filename = `img_${i}.${ext}`;
        const filePath = path.join(uploadDir, filename);
        fs.writeFileSync(filePath, buffer);
        savedPaths.push(filePath);
      }
    }

    return NextResponse.json({ uploadId, paths: savedPaths });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
