import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !ADMIN_EMAILS.includes(session.user.email)) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const [
    usersRes,
    jobsRes,
    jobsDoneRes,
    jobsFailedRes,
    planRes,
    recentUsersRes,
    recentJobsRes,
    dailySignupsRes,
    dailyJobsRes,
    allJobsRes,
    allUsersRes,
  ] = await Promise.all([
    // 총 가입자 수
    supabase.from('users').select('*', { count: 'exact', head: true }),
    // 총 영상 생성 수
    supabase.from('jobs').select('*', { count: 'exact', head: true }),
    // 성공한 영상
    supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'done'),
    // 실패한 영상
    supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'failed'),
    // 플랜별 사용자
    supabase.from('users').select('plan'),
    // 최근 가입자 10명
    supabase.from('users').select('id, name, email, image, plan, monthly_usage, created_at').order('created_at', { ascending: false }).limit(10),
    // 최근 영상 10개
    supabase.from('jobs').select('id, user_id, status, topic, business_name, created_at').order('created_at', { ascending: false }).limit(10),
    // 최근 7일 일별 가입자
    supabase.rpc('daily_signups_7d').then(r => r, () => ({ data: null })),
    // 최근 7일 일별 영상 생성
    supabase.rpc('daily_jobs_7d').then(r => r, () => ({ data: null })),
    // 유저별 누적 생성 수 집계용 전체 job의 user_id (monthly_usage는 크레딧 모델 전환 후 미집계 → jobs로 실집계)
    supabase.from('jobs').select('user_id'),
    // TOP 유저 메타데이터 조인용 전체 유저
    supabase.from('users').select('id, name, email, plan'),
  ]);

  // 플랜별 집계
  const planCounts: Record<string, number> = { free: 0, pro: 0, business: 0 };
  if (planRes.data) {
    for (const row of planRes.data) {
      const p = row.plan || 'free';
      planCounts[p] = (planCounts[p] || 0) + 1;
    }
  }

  // 유저별 누적 생성 수 (jobs 테이블 실집계)
  const genCount: Record<string, number> = {};
  for (const row of allJobsRes.data ?? []) {
    const uid = (row as { user_id: string | null }).user_id;
    if (uid) genCount[uid] = (genCount[uid] || 0) + 1;
  }

  // 최근 가입자에 누적 생성 수 부착
  const recentUsers = (recentUsersRes.data ?? []).map((u) => ({
    ...u,
    generatedCount: genCount[u.id] || 0,
  }));

  // 누적 생성 수 TOP 5 (jobs 실집계 기준)
  const userMeta = new Map((allUsersRes.data ?? []).map((u) => [u.id, u]));
  const topUsers = Object.entries(genCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([uid, count]) => {
      const m = userMeta.get(uid);
      return {
        id: uid,
        name: m?.name ?? null,
        email: m?.email ?? '',
        plan: m?.plan ?? 'free',
        generatedCount: count,
      };
    });

  return NextResponse.json({
    totalUsers: usersRes.count ?? 0,
    totalJobs: jobsRes.count ?? 0,
    doneJobs: jobsDoneRes.count ?? 0,
    failedJobs: jobsFailedRes.count ?? 0,
    planCounts,
    recentUsers,
    recentJobs: recentJobsRes.data ?? [],
    dailySignups: dailySignupsRes.data ?? null,
    dailyJobs: dailyJobsRes.data ?? null,
    topUsers,
  });
}
