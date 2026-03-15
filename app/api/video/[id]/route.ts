import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

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

  const videoPath = path.join(process.cwd(), 'public', 'videos', `${safeId}.mp4`);

  if (!fs.existsSync(videoPath)) {
    return NextResponse.json({ error: 'Video not found' }, { status: 404 });
  }

  const stat = fs.statSync(videoPath);
  const fileBuffer = fs.readFileSync(videoPath);

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(stat.size),
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
