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
    topUsersRes,
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
    // 영상 많이 만든 유저 TOP 5
    supabase.from('users').select('id, name, email, plan, monthly_usage').order('monthly_usage', { ascending: false }).limit(5),
  ]);

  // 플랜별 집계
  const planCounts: Record<string, number> = { free: 0, pro: 0, business: 0 };
  if (planRes.data) {
    for (const row of planRes.data) {
      const p = row.plan || 'free';
      planCounts[p] = (planCounts[p] || 0) + 1;
    }
  }

  return NextResponse.json({
    totalUsers: usersRes.count ?? 0,
    totalJobs: jobsRes.count ?? 0,
    doneJobs: jobsDoneRes.count ?? 0,
    failedJobs: jobsFailedRes.count ?? 0,
    planCounts,
    recentUsers: recentUsersRes.data ?? [],
    recentJobs: recentJobsRes.data ?? [],
    dailySignups: dailySignupsRes.data ?? null,
    dailyJobs: dailyJobsRes.data ?? null,
    topUsers: topUsersRes.data ?? [],
  });
}
