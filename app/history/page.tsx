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
  Youtube,
  Instagram,
  Link2,
} from 'lucide-react';
import Header from '@/components/Header';
import { buildPromoDescription, buildInstagramCaption } from '@/lib/promo-description';

interface HistoryJob {
  id: string;
  status: string;
  progress: number;
  topic: string | null;
  businessName: string | null;
  businessType: string | null;
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

export function HistoryTool({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [assets, setAssets] = useState<{ id: string; type: string; title: string | null; image: string; created_at: string }[]>([]);
  const [tab, setTab] = useState<'all' | 'video' | 'logo' | 'banner'>('all');
  // 유튜브/인스타 업로드 → 공유 링크
  const [ytConnected, setYtConnected] = useState(false);
  const [ytBusyId, setYtBusyId] = useState<string | null>(null);
  const [ytMsg, setYtMsg] = useState<Record<string, string>>({});
  const [igConnected, setIgConnected] = useState(false);
  const [igBusyId, setIgBusyId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/social/youtube/status').then((r) => r.json()).then((d) => setYtConnected(!!d.connected)).catch(() => {});
    fetch('/api/social/instagram/status').then((r) => r.json()).then((d) => setIgConnected(!!d.connected)).catch(() => {});
  }, []);

  const ytUrlOf = (job: HistoryJob) => (job.script as { youtubeUrl?: string } | null)?.youtubeUrl || '';
  const igUrlOf = (job: HistoryJob) => (job.script as { instagramUrl?: string } | null)?.instagramUrl || '';

  async function publishInstagram(job: HistoryJob) {
    setIgBusyId(job.id); setYtMsg((p) => ({ ...p, [job.id]: '' }));
    try {
      const meta = (job.script || {}) as { narration?: string; catchphrase?: string; buyLink?: string };
      const caption = buildInstagramCaption(meta.narration || meta.catchphrase || '', meta.buyLink || '', job.businessName || '', meta.catchphrase || '');
      const r = await fetch('/api/social/instagram/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id, caption }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '인스타 발행 실패');
      setData((prev) => prev ? {
        ...prev,
        jobs: prev.jobs.map((j) => j.id === job.id ? { ...j, script: { ...(j.script || {}), instagramUrl: d.url } } : j),
      } : prev);
      setYtMsg((p) => ({ ...p, [job.id]: '인스타 릴스로 발행했어요!' }));
    } catch (e) { setYtMsg((p) => ({ ...p, [job.id]: e instanceof Error ? e.message : String(e) })); }
    finally { setIgBusyId(null); }
  }

  async function publishYouTube(job: HistoryJob) {
    setYtBusyId(job.id); setYtMsg((p) => ({ ...p, [job.id]: '' }));
    try {
      const title = (job.businessName || job.topic?.replace(/^제품홍보:/, '') || '홍보 영상').trim().slice(0, 90);
      const meta = (job.script || {}) as { narration?: string; catchphrase?: string; buyLink?: string };
      // 제품홍보영상(캐릭터) 도구와 동일한 설명란: 나레이션 + 구매링크 + 쿠팡 고지 + 제작 크레딧
      const desc = buildPromoDescription(meta.narration || meta.catchphrase || '', meta.buyLink || '');
      const r = await fetch('/api/social/youtube/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id, title, description: desc, privacyStatus: 'unlisted' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '업로드 실패');
      // 반환된 링크를 job.script.youtubeUrl 에 반영 → 버튼이 '링크 복사'로 전환
      setData((prev) => prev ? {
        ...prev,
        jobs: prev.jobs.map((j) => j.id === job.id ? { ...j, script: { ...(j.script || {}), youtubeUrl: d.url } } : j),
      } : prev);
      setYtMsg((p) => ({ ...p, [job.id]: '유튜브에 올렸어요! 링크를 복사해 공유하세요.' }));
    } catch (e) { setYtMsg((p) => ({ ...p, [job.id]: e instanceof Error ? e.message : String(e) })); }
    finally { setYtBusyId(null); }
  }

  async function copyLink(url: string, id: string) {
    try { await navigator.clipboard.writeText(url); setYtMsg((p) => ({ ...p, [id]: '링크 복사됨!' })); }
    catch { setYtMsg((p) => ({ ...p, [id]: '복사 실패 — 링크를 길게 눌러 직접 복사하세요' })); }
  }

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/login');
    }
  }, [authStatus, router]);

  const fetchHistory = async () => {
    try {
      const [jr, ar] = await Promise.all([fetch('/api/jobs'), fetch('/api/assets')]);
      if (jr.ok) setData(await jr.json());
      if (ar.ok) { const ad = await ar.json(); setAssets(ad.assets || []); }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const editAsset = (a: { id: string; image: string; title: string | null }) => {
    try { sessionStorage.setItem('editLogo', JSON.stringify({ id: a.id, image: a.image, title: a.title })); } catch { /* ignore */ }
    router.push('/studio/logo');
  };

  const deleteAsset = async (id: string) => {
    if (!confirm('이 항목을 삭제하시겠습니까?')) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/assets?id=${id}`, { method: 'DELETE' });
      if (res.ok) setAssets((prev) => prev.filter((a) => a.id !== id));
      else alert('삭제에 실패했습니다.');
    } catch { alert('삭제 중 오류가 발생했습니다.'); }
    setDeleting(null);
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
    if (job.businessType) params.set('businessType', job.businessType);
    if (job.topic) params.set('topic', job.topic);
    if (job.duration) params.set('duration', String(job.duration));
    if (job.tone) params.set('tone', job.tone);
    if (job.imageCount > 0) params.set('imageJobId', job.id);
    // 행사 영상이면 mode·일시·장소 복원 (script._meta에 저장됨)
    const meta = (job.script as { _meta?: { mode?: string; eventDate?: string; location?: string } } | null)?._meta;
    if (meta?.mode === 'event') {
      params.set('mode', 'event');
      if (meta.eventDate) params.set('eventDate', meta.eventDate);
      if (meta.location) params.set('location', meta.location);
    }
    // 제품홍보영상(topic '제품홍보:…')은 제품 홍보 툴로, 행사는 행사, 그 외 업체 홍보로
    const isProduct = (job.topic || '').startsWith('제품홍보:');
    const base = isProduct
      ? (embedded ? '/studio/product-vs' : '/promo-character')
      : embedded
        ? (meta?.mode === 'event' ? '/studio/event' : '/studio/promo')
        : '/promo';
    router.push(`${base}?${params.toString()}`);
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
      <div className={embedded ? 'flex items-center justify-center' : 'min-h-screen bg-[#0F172A] flex items-center justify-center'} style={embedded ? { minHeight: 300 } : undefined}>
        <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
      </div>
    );
  }

  if (!session?.user) return null;

  const PLAN_LABELS: Record<string, string> = { free: '무료', pro: 'Pro', business: 'Business', admin: '관리자' };

  const showVideos = tab === 'all' || tab === 'video';
  const showAssets = tab === 'all' || tab === 'logo' || tab === 'banner';
  const filteredAssets = assets.filter((a) => tab === 'all' || tab === a.type);
  const jobsToShow = showVideos ? (data?.jobs ?? []) : [];
  const TABS: { id: typeof tab; label: string }[] = [
    { id: 'all', label: '전체' }, { id: 'video', label: '영상' }, { id: 'logo', label: '로고' }, { id: 'banner', label: '배너' },
  ];

  return (
    <div className={embedded ? 'st-toolskin rounded-2xl text-white' : 'min-h-screen bg-[#0F172A] text-white'}>
      {!embedded && <Header />}

      <div className={embedded ? 'pt-6 pb-10 px-4 sm:px-6' : 'pt-24 pb-16 px-4 sm:px-6'}>
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div>
              {!embedded && (
                <Link
                  href="/studio"
                  className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-3"
                >
                  <ArrowLeft className="w-4 h-4" />
                  영상 만들기
                </Link>
              )}
              <h1 className="text-2xl font-bold">내 라이브러리</h1>
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
              {!embedded && (
                <Link
                  href="/studio"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                  <Plus className="w-4 h-4" />
                  새 영상 만들기
                </Link>
              )}
            </div>
          </div>

          {/* 콘텐츠 타입 탭 */}
          <div className="flex gap-2 mb-6">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${tab === t.id ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white border-transparent' : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Empty state (영상) */}
          {showVideos && (data?.jobs?.length ?? 0) === 0 && filteredAssets.length === 0 && (
            <div className="text-center py-20">
              <Film className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-300 mb-2">아직 만든 영상이 없어요</h2>
              <p className="text-gray-500 mb-6">첫 번째 홍보영상을 만들어보세요!</p>
              <Link
                href="/studio"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold hover:opacity-90"
              >
                <Plus className="w-4 h-4" />
                홍보영상 만들기
              </Link>
            </div>
          )}

          {/* Job list (영상) — 콤팩트 그리드 (로고처럼) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {jobsToShow.map((job) => {
              const isPlaying = playingId === job.id;

              return (
                <div
                  key={job.id}
                  className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden hover:border-purple-500/30 transition-colors"
                >
                  <div>
                    {/* 영상 썸네일/플레이어 */}
                    <div className="bg-black/40 overflow-hidden">
                      {job.videoUrl && job.status === 'done' ? (
                        <div className="relative aspect-[9/16]">
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
                              className="relative w-full h-full group"
                            >
                              <video
                                src={job.videoUrl}
                                preload="metadata"
                                muted
                                playsInline
                                className="w-full h-full object-cover"
                                onLoadedData={(e) => {
                                  // 첫 프레임으로 이동
                                  const v = e.currentTarget;
                                  v.currentTime = 0.5;
                                }}
                              />
                              <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/20 transition-colors">
                                <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center group-hover:bg-white/30 transition-colors backdrop-blur-sm">
                                  <Play className="w-6 h-6 text-white ml-1" />
                                </div>
                              </div>
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="aspect-[9/16] flex items-center justify-center bg-gradient-to-br from-gray-800/50 to-gray-900/50">
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

                    {/* 콤팩트 정보 + 아이콘 (로고 카드와 동일) */}
                    <div className="p-3">
                      <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium truncate flex-1" title={job.businessName || job.topic || ''}>
                        {job.businessName || job.topic || '홍보영상'}
                      </p>
                      <div className="flex gap-1 flex-shrink-0">
                        {job.script && (
                          <button onClick={() => handleReuse(job)} title="수정" className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10">
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        {job.videoUrl && job.status === 'done' && (
                          <a href={job.videoUrl} download={`${job.businessName || 'shortsai'}.mp4`} title="다운로드" className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10">
                            <Download className="w-4 h-4" />
                          </a>
                        )}
                        {job.videoUrl && job.status === 'done' && ytUrlOf(job) && (
                          <button onClick={() => copyLink(ytUrlOf(job), job.id)} title="유튜브 링크 복사" className="p-2 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10">
                            <Link2 className="w-4 h-4" />
                          </button>
                        )}
                        {job.videoUrl && job.status === 'done' && !ytUrlOf(job) && ytConnected && (
                          <button onClick={() => publishYouTube(job)} disabled={ytBusyId === job.id} title="유튜브에 올려 링크 받기 (일부공개)" className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10">
                            {ytBusyId === job.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Youtube className="w-4 h-4" />}
                          </button>
                        )}
                        {job.videoUrl && job.status === 'done' && igUrlOf(job) && (
                          <a href={igUrlOf(job)} target="_blank" rel="noreferrer" title="인스타에서 보기" className="p-2 rounded-lg text-pink-400 hover:text-pink-300 hover:bg-pink-500/10">
                            <Instagram className="w-4 h-4" />
                          </a>
                        )}
                        {job.videoUrl && job.status === 'done' && !igUrlOf(job) && igConnected && (
                          <button onClick={() => publishInstagram(job)} disabled={igBusyId === job.id} title="인스타 릴스로 발행" className="p-2 rounded-lg text-gray-400 hover:text-pink-400 hover:bg-pink-500/10">
                            {igBusyId === job.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Instagram className="w-4 h-4" />}
                          </button>
                        )}
                        <button onClick={() => handleDelete(job.id)} disabled={deleting === job.id} title="삭제" className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10">
                          {deleting === job.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                      </div>
                      {ytMsg[job.id] && <div className="text-[11px] text-gray-400 mt-2 break-all">{ytMsg[job.id]}</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 에셋(로고·배너) 그리드 */}
          {showAssets && filteredAssets.length > 0 && (
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {filteredAssets.map((a) => (
                <div key={a.id} className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
                  <div className="aspect-square bg-white flex items-center justify-center p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.image} alt={a.title || a.type} className="max-w-full max-h-full object-contain" />
                  </div>
                  <div className="p-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{a.title || (a.type === 'logo' ? '로고' : '배너')}</p>
                      <p className="text-xs text-gray-500">{a.type === 'logo' ? '로고' : '배너'}</p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      {a.type === 'logo' && (
                        <button onClick={() => editAsset(a)} title="수정" className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10"><Pencil className="w-4 h-4" /></button>
                      )}
                      <a href={a.image} download={`${a.title || a.type}.png`} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10"><Download className="w-4 h-4" /></a>
                      <button onClick={() => deleteAsset(a.id)} disabled={deleting === a.id} className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10">
                        {deleting === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {(tab === 'logo' || tab === 'banner') && filteredAssets.length === 0 && (
            <div className="text-center py-16 text-gray-500">저장된 {tab === 'logo' ? '로고' : '배너'}가 없어요.</div>
          )}
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

// 기존 /history 라우트 — 단독 페이지 (스튜디오에선 <HistoryTool embedded /> 로 재사용)
export default function HistoryPage() {
  return <HistoryTool />;
}
