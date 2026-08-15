import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { uploadVideo, isConnected } from '@/lib/youtube';
import { getJob } from '@/lib/jobStore';
import { buildYouTubeTags } from '@/lib/promo-description';
import fs from 'fs';
import path from 'path';

/** 완성 영상(jobId)을 내 YouTube 채널에 업로드 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = (session?.user?.email || '').toLowerCase();
  const admins = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!email || (admins.length && !admins.includes(email))) {
    return NextResponse.json({ error: '관리자만 발행할 수 있습니다.' }, { status: 403 });
  }
  if (!isConnected()) return NextResponse.json({ error: 'YouTube 미연결' }, { status: 400 });

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
    return NextResponse.json({ ok: true, videoId, url: `https://youtu.be/${videoId}` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[youtube upload] 실패:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
