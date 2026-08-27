import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { LOGO_DIR } from '@/lib/menuSamples';

export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml',
};

// 로고 스타일 샘플 이미지 서빙 (data/logo-samples/). Next는 런타임 public 파일을 서빙하지 않아 API 경유.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  // 경로 조작 방지: 파일명만 허용
  const safe = path.basename(file || '');
  if (safe !== file || !safe) return NextResponse.json({ error: 'bad name' }, { status: 400 });
  const ext = safe.split('.').pop()?.toLowerCase() || '';
  const type = TYPES[ext];
  if (!type) return NextResponse.json({ error: 'unsupported' }, { status: 400 });

  const p = path.join(LOGO_DIR, safe);
  if (!fs.existsSync(p)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const buf = fs.readFileSync(p);
  return new NextResponse(new Uint8Array(buf), {
    headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' },
  });
}
