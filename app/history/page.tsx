'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Download,
  Trash2,
  Loader2,
  Play,
  Clock,
  AlertCircle,
  Film,
  RefreshCw,
  Pencil,
  Plus,
  X,
  ImageIcon,
} from 'lucide-react';
import Header from '@/components/Header';

interface HistoryJob {
  id: string;
  status: string;
  progress: number;
  topic: string | null;
  businessName: string | null;
  duration: number | null;
  tone: string | null;
  script: Record<string, unknown> | null;
  videoUrl: string | null;
  imageCount: number;
  error: string | null;
  createdAt: string;
}

interface HistoryResponse {
  plan: string;
  historyLimit: number;
  total: number;
  jobs: HistoryJob[];
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  done: { label: '완료', color: 'text-green-400 bg-green-500/10 border-green-500/30', icon: <Film className="w-3.5 h-3.5" /> },
  failed: { label: '실패', color: 'text-red-400 bg-red-500/10 border-red-500/30', icon: <AlertCircle className="w-3.5 h-3.5" /> },
  queued: { label: '대기중', color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30', icon: <Clock className="w-3.5 h-3.5" /> },
  generating_script: { label: '스크립트 생성중', color: 'text-blue-400 bg-blue-500/10 border-blue-500/30', icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
  generating_audio: { label: '음성 생성중', color: 'text-blue-400 bg-blue-500/10 border-blue-500/30', icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
  generating_video: { label: '영상 생성중', color: 'text-purple-400 bg-purple-500/10 border-purple-500/30', icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
};

export default function HistoryPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/login');
    }
  }, [authStatus, router]);

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/jobs');
      if (res.ok) {
        setData(await res.json());
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session?.user) fetchHistory();
  }, [session]);

  const handleDelete = async (jobId: string) => {
    if (!confirm('이 영상을 삭제하시겠습니까? 복구할 수 없습니다.')) return;
    setDeleting(jobId);
    try {
      const res = await fetch(`/api/jobs?id=${jobId}`, { method: 'DELETE' });
      if (res.ok) {
        setData((prev) =>
          prev
            ? { ...prev, total: prev.total - 1, jobs: prev.jobs.filter((j) => j.id !== jobId) }
            : prev
        );
      } else {
        alert('삭제에 실패했습니다.');
      }
    } catch {
      alert('삭제 중 오류가 발생했습니다.');
    }
    setDeleting(null);
  };

  const handleReuse = (job: HistoryJob) => {
    // 스크립트와 입력 정보를 쿼리 파라미터로 전달
    const params = new URLSearchParams();
    if (job.script) params.set('script', JSON.stringify(job.script));
    if (job.businessName) params.set('businessName', job.businessName);
    if (job.topic) params.set('topic', job.topic);
    if (job.duration) params.set('duration', String(job.duration));
    if (job.tone) params.set('tone', job.tone);
    if (job.imageCount > 0) params.set('imageJobId', job.id);
    router.push(`/promo?${params.toString()}`);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return '방금 전';
    if (diffMin < 60) return `${diffMin}분 전`;
    if (diffHour < 24) return `${diffHour}시간 전`;
    if (diffDay < 7) return `${diffDay}일 전`;
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  };

  if (authStatus === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-[#0B0A14] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
      </div>
    );
  }

  if (!session?.user) return null;

  const PLAN_LABELS: Record<string, string> = { free: '무료', pro: 'Pro', business: 'Business', admin: '관리자' };

  return (
    <div className="min-h-screen bg-[#0B0A14] text-white">
      <Header />

      <div className="pt-24 pb-16 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div>
              <Link
                href="/promo"
                className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-3"
              >
                <ArrowLeft className="w-4 h-4" />
                영상 만들기
              </Link>
              <h1 className="text-2xl font-bold">내 영상 히스토리</h1>
              <p className="text-sm text-gray-400 mt-1">
                {PLAN_LABELS[data?.plan || 'free']} 플랜 · 최대 {data?.historyLimit}개 보관
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => { setLoading(true); fetchHistory(); }}
                className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-gray-300 text-sm hover:bg-white/10 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <Link
                href="/promo"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                <Plus className="w-4 h-4" />
                새 영상 만들기
              </Link>
            </div>
          </div>

          {/* Empty state */}
          {data?.jobs.length === 0 && (
            <div className="text-center py-20">
              <Film className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-300 mb-2">아직 만든 영상이 없어요</h2>
              <p className="text-gray-500 mb-6">첫 번째 홍보영상을 만들어보세요!</p>
              <Link
                href="/promo"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold hover:opacity-90"
              >
                <Plus className="w-4 h-4" />
                홍보영상 만들기
              </Link>
            </div>
          )}

          {/* Job list */}
          <div className="space-y-4">
            {data?.jobs.map((job) => {
              const st = STATUS_MAP[job.status] || STATUS_MAP.queued;
              const isPlaying = playingId === job.id;

              return (
                <div
                  key={job.id}
                  className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden hover:border-purple-500/30 transition-colors"
                >
                  <div className="flex flex-col md:flex-row">
                    {/* 영상 썸네일/플레이어 */}
                    <div className="md:w-48 lg:w-56 flex-shrink-0 bg-black/40">
                      {job.videoUrl && job.status === 'done' ? (
                        <div className="relative aspect-[9/16] md:h-full">
                          {isPlaying ? (
                            <div className="relative w-full h-full">
                              <video
                                src={job.videoUrl}
                                controls
                                autoPlay
                                playsInline
                                className="w-full h-full object-contain bg-black"
                              />
                              <button
                                onClick={() => setPlayingId(null)}
                                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setPlayingId(job.id)}
                              className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-900/30 to-black/50 hover:from-purple-900/50 transition-colors group"
                            >
                              <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center group-hover:bg-white/30 transition-colors">
                                <Play className="w-6 h-6 text-white ml-1" />
                              </div>
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="aspect-[9/16] md:h-full flex items-center justify-center bg-gradient-to-br from-gray-800/50 to-gray-900/50">
                          {job.status === 'failed' ? (
                            <AlertCircle className="w-10 h-10 text-red-400/50" />
                          ) : (
                            <div className="text-center">
                              <Loader2 className="w-8 h-8 animate-spin text-purple-400/50 mx-auto mb-2" />
                              <span className="text-xs text-gray-500">{job.progress}%</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 정보 */}
                    <div className="flex-1 p-4 sm:p-5 flex flex-col">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-lg truncate">
                            {job.businessName || job.topic || '제목 없음'}
                          </h3>
                          <p className="text-sm text-gray-400 mt-0.5 truncate">
                            {job.topic && job.businessName ? job.topic : ''}
                          </p>
                        </div>
                        <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border shrink-0 ${st.color}`}>
                          {st.icon}
                          {st.label}
                        </span>
                      </div>

                      {/* 메타 정보 */}
                      <div className="flex flex-wrap gap-3 text-xs text-gray-500 mb-4">
                        <span>{formatDate(job.createdAt)}</span>
                        {job.duration && <span>{job.duration}초</span>}
                        {job.tone && <span>{job.tone}</span>}
                        {job.imageCount > 0 && (
                          <span className="flex items-center gap-1">
                            <ImageIcon className="w-3 h-3" />
                            사진 {job.imageCount}장
                          </span>
                        )}
                      </div>

                      {/* 에러 메시지 */}
                      {job.error && (
                        <p className="text-sm text-red-400/80 bg-red-500/10 rounded-lg px-3 py-2 mb-4">
                          {job.error}
                        </p>
                      )}

                      {/* 스크립트 미리보기 */}
                      {job.script && (
                        <div className="text-sm text-gray-400 bg-white/5 rounded-lg px-3 py-2 mb-4 line-clamp-2">
                          {extractScriptPreview(job.script)}
                        </div>
                      )}

                      {/* 액션 버튼 */}
                      <div className="mt-auto flex flex-wrap gap-2">
                        {job.videoUrl && job.status === 'done' && (
                          <a
                            href={job.videoUrl}
                            download={`${job.businessName || 'shortsai'}_홍보영상.mp4`}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-sm font-medium hover:bg-purple-500 transition-colors"
                          >
                            <Download className="w-4 h-4" />
                            다운로드
                          </a>
                        )}

                        {job.script && (
                          <button
                            onClick={() => handleReuse(job)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/10 text-white text-sm font-medium hover:bg-white/20 transition-colors border border-white/10"
                          >
                            <Pencil className="w-4 h-4" />
                            스크립트 수정 / 재생성
                          </button>
                        )}

                        <button
                          onClick={() => handleDelete(job.id)}
                          disabled={deleting === job.id}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-gray-400 text-sm hover:text-red-400 hover:bg-red-500/10 transition-colors ml-auto"
                        >
                          {deleting === job.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 스크립트 JSON에서 미리보기 텍스트 추출 */
function extractScriptPreview(script: Record<string, unknown>): string {
  try {
    const sections = (script as { sections?: { text?: string }[] }).sections;
    if (Array.isArray(sections)) {
      return sections
        .map((s) => s.text || '')
        .filter(Boolean)
        .join(' ')
        .slice(0, 120) + '...';
    }
    // title fallback
    if (typeof script === 'object' && 'title' in script) {
      return String((script as { title: string }).title);
    }
  } catch {
    // ignore
  }
  return '';
}
