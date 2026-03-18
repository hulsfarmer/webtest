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
  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, status, progress, topic, business_name, duration, tone, script, video_url, error, created_at')
    .eq('user_id', userId)
    .in('status', ['done', 'failed', 'queued', 'generating_script', 'generating_audio', 'generating_video'])
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[API/jobs] query error:', error.message);
    return NextResponse.json({ error: '목록 조회 실패' }, { status: 500 });
  }

  // 영상 파일 존재 여부 확인
  const videoDir = path.join(process.cwd(), 'public', 'videos');
  const items = (jobs || []).map((job) => {
    const videoExists = job.status === 'done' && fs.existsSync(path.join(videoDir, `${job.id}.mp4`));
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      topic: job.topic,
      businessName: job.business_name,
      duration: job.duration,
      tone: job.tone,
      script: job.script,
      videoUrl: videoExists ? `/api/video/${job.id}` : null,
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

  // DB에서 삭제
  await supabase.from('jobs').delete().eq('id', jobId);

  return NextResponse.json({ ok: true });
}
