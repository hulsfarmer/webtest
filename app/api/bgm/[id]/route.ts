import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { resolveBgmPath } from '@/lib/bgm';
import type { BgmId } from '@/lib/bgm-catalog';

// 미리듣기용: 영상에 실제로 쓰이는 캐시 BGM 파일을 그대로 스트리밍
// (라이브 mixkit url은 원본이 바뀔 수 있어 캐시 파일과 달라짐 → 반드시 캐시 사용)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const safeId = id.replace(/[^a-z]/g, '') as BgmId;
  try {
    const p = await resolveBgmPath(safeId);
    if (!p || !fs.existsSync(p)) {
      return NextResponse.json({ error: 'BGM not found' }, { status: 404 });
    }
    const buf = fs.readFileSync(p);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(buf.length),
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return NextResponse.json({ error: 'BGM error' }, { status: 500 });
  }
}
