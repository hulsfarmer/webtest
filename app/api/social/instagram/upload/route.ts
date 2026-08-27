import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { publishReel, isConnected } from '@/lib/instagram';
import { getJob, updateJob } from '@/lib/jobStore';
import fs from 'fs';
import path from 'path';

/** 완성 영상(jobId)을 내 인스타 비즈니스 계정에 릴스로 발행 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id ?? (process.env.NODE_ENV !== 'production' ? 'dev-local' : null);
  if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!isConnected()) return NextResponse.json({ error: '인스타 연결이 아직 안 되어 있어요. 관리자 연결이 필요합니다.' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const jobId = String(body.jobId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  let caption = String(body.caption || '').trim();
  if (!jobId) return NextResponse.json({ error: 'jobId 필요' }, { status: 400 });

  // 영상 파일 존재 확인 (인스타는 파일이 아니라 공개 URL을 받지만, 없는 잡 방지용)
  const filePath = path.join(process.cwd(), 'public', 'videos', `${jobId}.mp4`);
  if (!fs.existsSync(filePath)) return NextResponse.json({ error: '영상을 찾을 수 없습니다.' }, { status: 404 });

  // 캡션 미전달 시 저장된 잡 메타(내레이션)로 구성
  if (!caption) {
    try {
      const job = await getJob(jobId);
      const meta = job?.script ? JSON.parse(job.script) as { narration?: string; businessName?: string } : {};
      caption = (meta.narration || meta.businessName || '').toString().trim();
    } catch { /* 캡션은 부가정보 */ }
  }

  // 인스타가 가져갈 공개 영상 URL
  const videoUrl = `https://shortsai.kr/api/video/${jobId}`;

  try {
    const { mediaId, permalink } = await publishReel(videoUrl, caption);
    const url = permalink || `https://www.instagram.com/`;
    try {
      const job = await getJob(jobId);
      const meta = job?.script ? JSON.parse(job.script) : {};
      meta.instagramUrl = url;
      await updateJob(jobId, { script: JSON.stringify(meta) });
    } catch { /* 저장 실패해도 발행은 성공 */ }
    return NextResponse.json({ ok: true, mediaId, url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[instagram upload] 실패:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
