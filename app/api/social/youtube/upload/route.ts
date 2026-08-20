import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { uploadVideo, isConnected } from '@/lib/youtube';
import { getJob, updateJob } from '@/lib/jobStore';
import { buildYouTubeTags } from '@/lib/promo-description';
import fs from 'fs';
import path from 'path';

/** 완성 영상(jobId)을 내 YouTube 채널에 업로드 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id ?? (process.env.NODE_ENV !== 'production' ? 'dev-local' : null);
  if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  // 업로드는 플랫폼(관리자) 채널로 올라감(중앙 호스팅). 미연결이면 관리자 연결 필요.
  if (!isConnected()) return NextResponse.json({ error: '유튜브 업로드가 아직 준비 중입니다. 잠시 후 다시 시도해주세요.' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const jobId = String(body.jobId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  let tags = Array.isArray(body.tags) ? body.tags.map((t: unknown) => String(t)).slice(0, 15) : [];
  const privacyStatus = ['public', 'unlisted', 'private'].includes(body.privacyStatus) ? body.privacyStatus : 'private';
  if (!jobId || !title) return NextResponse.json({ error: 'jobId·title 필요' }, { status: 400 });

  // 클라가 태그를 안 보냈으면(=메인 결과패널 발행 등) 저장된 잡 메타에서 태그를 불러온다
  if (tags.length === 0) {
    try {
      const job = await getJob(jobId);
      const meta = job?.script ? JSON.parse(job.script) as { tags?: string[]; narration?: string; businessName?: string; catchphrase?: string } : {};
      if (meta.tags && meta.tags.length) tags = meta.tags.slice(0, 15);
      else if (meta.narration) tags = buildYouTubeTags(meta.businessName || '', meta.catchphrase || '', meta.narration).slice(0, 15);
    } catch { /* 태그는 부가정보이므로 실패해도 업로드는 진행 */ }
  }

  const filePath = path.join(process.cwd(), 'public', 'videos', `${jobId}.mp4`);
  if (!fs.existsSync(filePath)) return NextResponse.json({ error: '영상을 찾을 수 없습니다.' }, { status: 404 });

  try {
    const videoId = await uploadVideo(filePath, { title, description, tags, privacyStatus });
    const url = `https://youtu.be/${videoId}`;
    // 링크를 job 에 저장 → 라이브러리에서 '링크 복사'가 새로고침 후에도 유지
    try {
      const job = await getJob(jobId);
      const meta = job?.script ? JSON.parse(job.script) : {};
      meta.youtubeUrl = url;
      await updateJob(jobId, { script: JSON.stringify(meta) });
    } catch { /* 저장 실패해도 업로드는 성공 */ }
    return NextResponse.json({ ok: true, videoId, url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[youtube upload] 실패:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
