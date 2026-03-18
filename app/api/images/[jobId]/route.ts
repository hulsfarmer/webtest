import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import fs from 'fs';
import path from 'path';

/**
 * GET /api/images/{jobId} — 해당 job의 업로드된 이미지 목록 반환
 * 반환: { images: ["/api/images/{jobId}?idx=0", ...] }
 *
 * GET /api/images/{jobId}?idx=0 — 특정 이미지 파일 반환
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { jobId } = await params;
  // Sanitize jobId
  const safeId = jobId.replace(/[^a-zA-Z0-9\-]/g, '');
  if (!safeId) {
    return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 });
  }

  // 본인 job인지 확인
  const { data: job } = await supabase
    .from('jobs')
    .select('user_id')
    .eq('id', safeId)
    .single();

  if (!job || job.user_id !== session.user.id) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const uploadsDir = path.join(process.cwd(), 'data', 'uploads', safeId);

  // idx 파라미터가 있으면 특정 이미지 파일 반환
  const idxParam = req.nextUrl.searchParams.get('idx');
  if (idxParam !== null) {
    const idx = parseInt(idxParam, 10);
    if (isNaN(idx) || idx < 0) {
      return NextResponse.json({ error: 'Invalid idx' }, { status: 400 });
    }

    // 파일 찾기 (img_0.jpg, img_0.jpeg, img_0.png, img_0.webp)
    const exts = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
    let filePath: string | null = null;
    for (const ext of exts) {
      const candidate = path.join(uploadsDir, `img_${idx}.${ext}`);
      if (fs.existsSync(candidate)) {
        filePath = candidate;
        break;
      }
    }

    if (!filePath) {
      return NextResponse.json({ error: '이미지를 찾을 수 없습니다.' }, { status: 404 });
    }

    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': mimeMap[ext] || 'image/jpeg',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  }

  // idx 없으면 이미지 목록 반환
  if (!fs.existsSync(uploadsDir)) {
    return NextResponse.json({ images: [] });
  }

  const files = fs.readdirSync(uploadsDir)
    .filter(f => /^img_\d+\.\w+$/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/img_(\d+)/)?.[1] || '0', 10);
      const numB = parseInt(b.match(/img_(\d+)/)?.[1] || '0', 10);
      return numA - numB;
    });

  const images = files.map((_, i) => `/api/images/${safeId}?idx=${i}`);

  return NextResponse.json({ images });
}
