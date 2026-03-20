import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import fs from 'fs';
import path from 'path';

// 플랜별 보관 개수 제한
const HISTORY_LIMITS: Record<string, number> = {
  free: 3,
  pro: 30,
  business: 100,
  admin: 9999,
};

/**
 * GET /api/jobs — 사용자의 영상 히스토리 목록
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const userId = session.user.id;

  // 사용자 플랜 조회
  const { data: userData } = await supabase
    .from('users')
    .select('plan')
    .eq('id', userId)
    .single();

  const plan = userData?.plan || 'free';
  const limit = HISTORY_LIMITS[plan] || 3;

  // 완료된 영상 + 최근 진행 중 영상 조회 (최신순)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type JobRow = any;
  let jobs: JobRow[] | null = null;

  // Try with business_type column first, fallback without it
  const result1 = await supabase
    .from('jobs')
    .select('id, status, progress, topic, business_name, business_type, duration, tone, script, video_url, error, created_at')
    .eq('user_id', userId)
    .in('status', ['done', 'failed', 'queued', 'generating_script', 'generating_audio', 'generating_video'])
    .order('created_at', { ascending: false })
    .limit(limit);

  if (result1.error) {
    // Fallback: business_type column might not exist yet
    const result2 = await supabase
      .from('jobs')
      .select('id, status, progress, topic, business_name, duration, tone, script, video_url, error, created_at')
      .eq('user_id', userId)
      .in('status', ['done', 'failed', 'queued', 'generating_script', 'generating_audio', 'generating_video'])
      .order('created_at', { ascending: false })
      .limit(limit);
    if (result2.error) {
      console.error('[API/jobs] query error:', result2.error.message);
      return NextResponse.json({ error: '목록 조회 실패' }, { status: 500 });
    }
    jobs = result2.data;
  } else {
    jobs = result1.data;
  }

  // 영상 파일 존재 여부 + 이미지 존재 여부 확인
  const videoDir = path.join(process.cwd(), 'public', 'videos');
  const uploadsDir = path.join(process.cwd(), 'data', 'uploads');
  const items = (jobs || []).map((job: JobRow) => {
    const videoExists = job.status === 'done' && fs.existsSync(path.join(videoDir, `${job.id}.mp4`));
    // 업로드 이미지 폴더 존재 여부 확인
    const imgDir = path.join(uploadsDir, job.id);
    let imageCount = 0;
    if (fs.existsSync(imgDir)) {
      imageCount = fs.readdirSync(imgDir).filter(f => /^img_\d+\.\w+$/.test(f)).length;
    }
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      topic: job.topic,
      businessName: job.business_name ?? null,
      businessType: job.business_type ?? null,
      duration: job.duration,
      tone: job.tone,
      script: job.script,
      videoUrl: videoExists ? `/api/video/${job.id}` : null,
      imageCount,
      error: job.error,
      createdAt: job.created_at,
    };
  });

  return NextResponse.json({
    plan,
    historyLimit: limit,
    total: items.length,
    jobs: items,
  });
}

/**
 * DELETE /api/jobs?id=xxx — 특정 영상 삭제
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const jobId = req.nextUrl.searchParams.get('id');
  if (!jobId) {
    return NextResponse.json({ error: 'id 파라미터가 필요합니다.' }, { status: 400 });
  }

  // 본인 영상인지 확인
  const { data: job } = await supabase
    .from('jobs')
    .select('id, user_id')
    .eq('id', jobId)
    .single();

  if (!job || job.user_id !== session.user.id) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  // 영상 파일 삭제
  const videoPath = path.join(process.cwd(), 'public', 'videos', `${jobId}.mp4`);
  if (fs.existsSync(videoPath)) {
    fs.unlinkSync(videoPath);
  }

  // 업로드 이미지 폴더 삭제
  const imgDir = path.join(process.cwd(), 'data', 'uploads', jobId);
  try { fs.rmSync(imgDir, { recursive: true, force: true }); } catch { /* ignore */ }

  // DB에서 삭제
  await supabase.from('jobs').delete().eq('id', jobId);

  return NextResponse.json({ ok: true });
}
