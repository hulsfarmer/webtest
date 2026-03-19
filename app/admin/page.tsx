'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  Users,
  Video,
  CheckCircle,
  XCircle,
  Crown,
  RefreshCw,
  ArrowLeft,
  TrendingUp,
  Clock,
  Shield,
  Loader2,
  Star,
  MessageSquare,
  Trash2,
} from 'lucide-react';

interface AdminStats {
  totalUsers: number;
  totalJobs: number;
  doneJobs: number;
  failedJobs: number;
  planCounts: Record<string, number>;
  recentUsers: Array<{
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    plan: string;
    monthly_usage: number;
    created_at: string;
  }>;
  recentJobs: Array<{
    id: string;
    user_id: string;
    status: string;
    topic: string | null;
    business_name: string | null;
    created_at: string;
  }>;
  dailySignups: Array<{ day: string; count: number }> | null;
  dailyJobs: Array<{ day: string; count: number }> | null;
  topUsers: Array<{
    id: string;
    name: string | null;
    email: string;
    plan: string;
    monthly_usage: number;
  }>;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  queued: { label: '대기중', color: 'text-yellow-400' },
  generating_script: { label: '스크립트 생성', color: 'text-blue-400' },
  generating_audio: { label: '오디오 생성', color: 'text-blue-400' },
  generating_video: { label: '영상 생성', color: 'text-blue-400' },
  done: { label: '완료', color: 'text-green-400' },
  failed: { label: '실패', color: 'text-red-400' },
};

const PLAN_LABELS: Record<string, { label: string; color: string }> = {
  free: { label: 'Free', color: 'bg-gray-600' },
  pro: { label: 'Pro', color: 'bg-purple-600' },
  business: { label: 'Business', color: 'bg-blue-600' },
};

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: typeof Users;
  label: string;
  value: number | string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="glass-card p-6 rounded-2xl">
      <div className="flex items-center gap-3 mb-3">
        <div className={`p-2 rounded-xl ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <span className="text-gray-400 text-sm">{label}</span>
      </div>
      <p className="text-3xl font-bold text-white">{value}</p>
      {sub && <p className="text-sm text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

function MiniBar({ data, label }: { data: Array<{ day: string; count: number }> | null; label: string }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="glass-card p-6 rounded-2xl">
      <h3 className="text-gray-400 text-sm mb-4">{label}</h3>
      <div className="flex items-end gap-2 h-24">
        {data.map((d) => (
          <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-xs text-gray-400">{d.count}</span>
            <div
              className="w-full bg-gradient-to-t from-purple-600 to-blue-500 rounded-t"
              style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? '4px' : '0px' }}
            />
            <span className="text-[10px] text-gray-500">{d.day.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '방금 전';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

interface ReviewItem {
  id: string;
  user_id: string;
  job_id: string | null;
  rating: number;
  text: string;
  display_name: string | null;
  business_type: string | null;
  status: string;
  created_at: string;
  users?: { name: string | null; email: string };
}

export default function AdminPage() {
  const { data: session, status } = useSession();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/stats');
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '데이터를 불러올 수 없습니다.');
      }
      setStats(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchReviews = useCallback(async () => {
    setReviewsLoading(true);
    try {
      const res = await fetch('/api/admin/reviews');
      if (res.ok) {
        const data = await res.json();
        setReviews(data.reviews ?? []);
      }
    } catch { /* ignore */ }
    setReviewsLoading(false);
  }, []);

  const handleReviewAction = async (id: string, action: 'approved' | 'rejected') => {
    await fetch('/api/admin/reviews', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: action }),
    });
    fetchReviews();
  };

  const handleReviewDelete = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    await fetch('/api/admin/reviews', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    fetchReviews();
  };

  useEffect(() => {
    if (status === 'authenticated') {
      fetchStats();
      fetchReviews();
    }
  }, [status, fetchStats, fetchReviews]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass-card p-8 rounded-2xl text-center">
          <Shield className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <p className="text-white text-lg">로그인이 필요합니다.</p>
          <Link href="/login" className="mt-4 inline-block text-purple-400 hover:text-purple-300">
            로그인하기 &rarr;
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass-card p-8 rounded-2xl text-center max-w-md">
          <Shield className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <p className="text-white text-lg mb-2">접근 거부</p>
          <p className="text-gray-400 text-sm">{error}</p>
          <Link href="/" className="mt-4 inline-block text-purple-400 hover:text-purple-300">
            홈으로 돌아가기 &rarr;
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-gray-400 hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold gradient-text">Admin Dashboard</h1>
              <p className="text-gray-500 text-sm">{session?.user?.email}</p>
            </div>
          </div>
          <button
            onClick={fetchStats}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>

        {loading && !stats ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
          </div>
        ) : stats ? (
          <>
            {/* Stat Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <StatCard icon={Users} label="총 가입자" value={stats.totalUsers} color="bg-purple-600/30" />
              <StatCard icon={Video} label="총 영상 생성" value={stats.totalJobs} color="bg-blue-600/30" />
              <StatCard
                icon={CheckCircle}
                label="성공"
                value={stats.doneJobs}
                sub={stats.totalJobs > 0 ? `${Math.round((stats.doneJobs / stats.totalJobs) * 100)}% 성공률` : undefined}
                color="bg-green-600/30"
              />
              <StatCard icon={XCircle} label="실패" value={stats.failedJobs} color="bg-red-600/30" />
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
              <MiniBar data={stats.dailySignups} label="최근 7일 가입자" />
              <MiniBar data={stats.dailyJobs} label="최근 7일 영상 생성" />
            </div>

            {/* Plan Distribution + Top Users */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
              {/* Plan Distribution */}
              <div className="glass-card p-6 rounded-2xl">
                <h3 className="text-gray-400 text-sm mb-4 flex items-center gap-2">
                  <Crown className="w-4 h-4" /> 플랜별 사용자
                </h3>
                <div className="space-y-3">
                  {Object.entries(stats.planCounts).map(([plan, count]) => {
                    const pct = stats.totalUsers > 0 ? (count / stats.totalUsers) * 100 : 0;
                    const info = PLAN_LABELS[plan] || { label: plan, color: 'bg-gray-600' };
                    return (
                      <div key={plan}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-300">{info.label}</span>
                          <span className="text-gray-400">{count}명 ({Math.round(pct)}%)</span>
                        </div>
                        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                          <div className={`h-full ${info.color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Top Users */}
              <div className="glass-card p-6 rounded-2xl">
                <h3 className="text-gray-400 text-sm mb-4 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> 이번 달 TOP 사용자
                </h3>
                <div className="space-y-3">
                  {stats.topUsers.map((user, i) => (
                    <div key={user.id} className="flex items-center gap-3">
                      <span className="text-gray-500 text-sm w-5">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm truncate">{user.name || user.email}</p>
                        <p className="text-gray-500 text-xs truncate">{user.email}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${PLAN_LABELS[user.plan]?.color || 'bg-gray-600'} text-white`}>
                        {PLAN_LABELS[user.plan]?.label || user.plan}
                      </span>
                      <span className="text-purple-400 text-sm font-medium">{user.monthly_usage}회</span>
                    </div>
                  ))}
                  {stats.topUsers.length === 0 && (
                    <p className="text-gray-500 text-sm">아직 데이터가 없습니다.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Recent Users */}
            <div className="glass-card p-6 rounded-2xl mb-8">
              <h3 className="text-gray-400 text-sm mb-4 flex items-center gap-2">
                <Clock className="w-4 h-4" /> 최근 가입자
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 border-b border-white/5">
                      <th className="text-left pb-3 font-medium">사용자</th>
                      <th className="text-left pb-3 font-medium">플랜</th>
                      <th className="text-left pb-3 font-medium">이번 달 사용</th>
                      <th className="text-right pb-3 font-medium">가입일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentUsers.map((user) => (
                      <tr key={user.id} className="border-b border-white/5 last:border-0">
                        <td className="py-3">
                          <div className="flex items-center gap-3">
                            {user.image ? (
                              <img src={user.image} alt="" className="w-8 h-8 rounded-full" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-purple-600/30 flex items-center justify-center text-white text-xs">
                                {(user.name || user.email)?.[0]?.toUpperCase()}
                              </div>
                            )}
                            <div>
                              <p className="text-white">{user.name || '-'}</p>
                              <p className="text-gray-500 text-xs">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${PLAN_LABELS[user.plan]?.color || 'bg-gray-600'} text-white`}>
                            {PLAN_LABELS[user.plan]?.label || user.plan}
                          </span>
                        </td>
                        <td className="text-gray-300">{user.monthly_usage}회</td>
                        <td className="text-right text-gray-400">{timeAgo(user.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {stats.recentUsers.length === 0 && (
                  <p className="text-gray-500 text-sm text-center py-4">아직 가입자가 없습니다.</p>
                )}
              </div>
            </div>

            {/* Recent Jobs */}
            <div className="glass-card p-6 rounded-2xl">
              <h3 className="text-gray-400 text-sm mb-4 flex items-center gap-2">
                <Video className="w-4 h-4" /> 최근 영상 생성
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 border-b border-white/5">
                      <th className="text-left pb-3 font-medium">업체명</th>
                      <th className="text-left pb-3 font-medium">주제</th>
                      <th className="text-left pb-3 font-medium">상태</th>
                      <th className="text-right pb-3 font-medium">생성일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentJobs.map((job) => {
                      const s = STATUS_LABELS[job.status] || { label: job.status, color: 'text-gray-400' };
                      return (
                        <tr key={job.id} className="border-b border-white/5 last:border-0">
                          <td className="py-3 text-white">{job.business_name || '-'}</td>
                          <td className="text-gray-300">{job.topic || '-'}</td>
                          <td>
                            <span className={`${s.color} text-xs font-medium`}>{s.label}</span>
                          </td>
                          <td className="text-right text-gray-400">{timeAgo(job.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {stats.recentJobs.length === 0 && (
                  <p className="text-gray-500 text-sm text-center py-4">아직 생성된 영상이 없습니다.</p>
                )}
              </div>
            </div>

            {/* Reviews Management */}
            <div className="glass-card p-6 rounded-2xl mt-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-gray-400 text-sm flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" /> 고객 후기 관리
                  <span className="text-xs text-gray-600">
                    (대기 {reviews.filter(r => r.status === 'pending').length}건)
                  </span>
                </h3>
                <button
                  onClick={fetchReviews}
                  disabled={reviewsLoading}
                  className="text-xs text-gray-500 hover:text-white transition-colors flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${reviewsLoading ? 'animate-spin' : ''}`} />
                  새로고침
                </button>
              </div>

              {reviews.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">아직 후기가 없습니다.</p>
              ) : (
                <div className="space-y-3">
                  {reviews.map((r) => {
                    const statusColor = r.status === 'approved' ? 'text-green-400' : r.status === 'rejected' ? 'text-red-400' : 'text-yellow-400';
                    const statusLabel = r.status === 'approved' ? '승인됨' : r.status === 'rejected' ? '거절됨' : '대기중';
                    return (
                      <div key={r.id} className={`p-4 rounded-xl bg-white/3 border ${r.status === 'pending' ? 'border-yellow-500/20' : 'border-white/5'}`}>
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex items-center gap-2">
                            <div className="flex gap-0.5">
                              {Array.from({ length: r.rating }).map((_, i) => (
                                <Star key={i} className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                              ))}
                            </div>
                            <span className="text-white text-sm font-medium">{r.display_name || '익명'}</span>
                            {r.business_type && (
                              <span className="text-gray-500 text-xs">· {r.business_type}</span>
                            )}
                            <span className={`text-xs ${statusColor}`}>[{statusLabel}]</span>
                          </div>
                          <span className="text-gray-500 text-xs whitespace-nowrap">{timeAgo(r.created_at)}</span>
                        </div>
                        <p className="text-gray-300 text-sm mb-2">&ldquo;{r.text}&rdquo;</p>
                        <div className="flex items-center gap-2 text-xs">
                          {r.users && (
                            <span className="text-gray-600">{r.users.email}</span>
                          )}
                          <div className="ml-auto flex gap-2">
                            {r.status !== 'approved' && (
                              <button
                                onClick={() => handleReviewAction(r.id, 'approved')}
                                className="px-3 py-1 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
                              >
                                승인
                              </button>
                            )}
                            {r.status !== 'rejected' && (
                              <button
                                onClick={() => handleReviewAction(r.id, 'rejected')}
                                className="px-3 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                              >
                                거절
                              </button>
                            )}
                            <button
                              onClick={() => handleReviewDelete(r.id)}
                              className="px-2 py-1 rounded-lg bg-white/5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
