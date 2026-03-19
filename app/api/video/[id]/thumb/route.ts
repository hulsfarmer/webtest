import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Sanitize id to prevent path traversal
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  const thumbPath = path.join(process.cwd(), 'public', 'videos', `${safeId}_thumb.jpg`);

  // If thumbnail already exists, serve it
  if (fs.existsSync(thumbPath)) {
    const buffer = fs.readFileSync(thumbPath);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(buffer.length),
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }

  // Generate thumbnail on-the-fly from video
  const videoPath = path.join(process.cwd(), 'public', 'videos', `${safeId}.mp4`);
  if (!fs.existsSync(videoPath)) {
    return NextResponse.json({ error: 'Video not found' }, { status: 404 });
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegPath = require('ffmpeg-static') as string;
    await execAsync(
      `"${ffmpegPath}" -i "${videoPath}" -ss 0.5 -vframes 1 -q:v 3 -update 1 "${thumbPath}" -y`
    );

    const buffer = fs.readFileSync(thumbPath);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(buffer.length),
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    console.error('[Thumb] Failed to generate thumbnail:', err);
    return NextResponse.json({ error: 'Failed to generate thumbnail' }, { status: 500 });
  }
}
