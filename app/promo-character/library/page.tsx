'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface LibItem {
  id: string;
  title: string;
  catchphrase: string;
  status: string;
  progress: number;
  videoUrl: string | null;
  buyLink: string;
  description: string;
  tags: string[];
  error: string | null;
  youtubeUrl: string;
  instagramUrl: string;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  done: '완료', failed: '실패', queued: '대기중',
  generating_script: '대본 생성중', generating_audio: '음성 생성중', generating_video: '영상 생성중',
};

export default function LibraryPage() {
  const [items, setItems] = useState<LibItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [ytConnected, setYtConnected] = useState(false);
  const [igConnected, setIgConnected] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [igBusyId, setIgBusyId] = useState('');
  const [msg, setMsg] = useState<Record<string, string>>({});

  const load = async () => {
    try {
      const r = await fetch('/api/promo-character/library');
      const d = await r.json();
      if (r.ok) setItems(d.items || []);
    } catch { /* noop */ } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    fetch('/api/social/youtube/status').then((r) => r.json()).then((d) => setYtConnected(!!d.connected)).catch(() => {});
    fetch('/api/social/instagram/status').then((r) => r.json()).then((d) => setIgConnected(!!d.connected)).catch(() => {});
  }, []);

  const setItemMsg = (id: string, m: string) => setMsg((p) => ({ ...p, [id]: m }));

  const publish = async (it: LibItem) => {
    setBusyId(it.id); setItemMsg(it.id, '');
    try {
      const title = `${it.title} ${it.catchphrase}`.trim().slice(0, 90) || it.title;
      const r = await fetch('/api/social/youtube/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: it.id, title, description: it.description, tags: it.tags || [], privacyStatus: 'private' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '업로드 실패');
      // 링크를 아이템에 저장 → '링크 복사' 버튼 표시(새로고침 후에도 API가 반환)
      setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, youtubeUrl: d.url } : x));
      setItemMsg(it.id, '유튜브에 올렸어요! 링크를 복사해 공유하세요.');
    } catch (e) { setItemMsg(it.id, e instanceof Error ? e.message : String(e)); }
    finally { setBusyId(''); }
  };

  const publishInstagram = async (it: LibItem) => {
    setIgBusyId(it.id); setItemMsg(it.id, '');
    try {
      // 설명(it.description)이 이미 첫 줄에 해시태그를 포함하므로 그대로 사용(중복 방지)
      const caption = it.description;
      const r = await fetch('/api/social/instagram/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: it.id, caption }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '인스타 발행 실패');
      setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, instagramUrl: d.url } : x));
      setItemMsg(it.id, '인스타 릴스로 발행했어요!');
    } catch (e) { setItemMsg(it.id, e instanceof Error ? e.message : String(e)); }
    finally { setIgBusyId(''); }
  };

  const copyLink = async (it: LibItem) => {
    try { await navigator.clipboard.writeText(it.youtubeUrl); setItemMsg(it.id, '링크 복사됨!'); }
    catch { setItemMsg(it.id, '복사 실패 — 링크를 길게 눌러 직접 복사하세요'); }
  };

  const copyDesc = async (it: LibItem) => {
    try { await navigator.clipboard.writeText(it.description); setItemMsg(it.id, '설명 복사됨'); }
    catch { setItemMsg(it.id, '복사 실패 — 길게 눌러 직접 복사하세요'); }
  };

  const remove = async (it: LibItem) => {
    if (!confirm(`"${it.title}" 영상을 삭제할까요? 복구할 수 없습니다.`)) return;
    setBusyId(it.id);
    try {
      const r = await fetch(`/api/promo-character/library?id=${it.id}`, { method: 'DELETE' });
      if (r.ok) setItems((prev) => prev.filter((x) => x.id !== it.id));
      else setItemMsg(it.id, '삭제 실패');
    } finally { setBusyId(''); }
  };

  const fmtDate = (s: string) => {
    const d = new Date(s), diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60000), hr = Math.floor(diff / 3600000), day = Math.floor(diff / 86400000);
    if (min < 1) return '방금 전'; if (min < 60) return `${min}분 전`;
    if (hr < 24) return `${hr}시간 전`; if (day < 7) return `${day}일 전`;
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-4 py-10">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/studio" className="text-sm text-neutral-400 hover:text-white">← 영상 만들기</Link>
            <h1 className="text-2xl font-bold mt-2">내 홍보 영상</h1>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`text-[11px] rounded-full px-2 py-0.5 ${ytConnected ? 'bg-green-900/60 text-green-300' : 'bg-neutral-800 text-neutral-400'}`}>
              유튜브 업로드 {ytConnected ? '가능' : '준비중'}
            </span>
          </div>
        </div>

        {loading && <div className="text-sm text-neutral-500">불러오는 중...</div>}
        {!loading && items.length === 0 && (
          <div className="text-center py-20 text-neutral-500">
            아직 만든 영상이 없어요.
            <div className="mt-4"><Link href="/studio" className="text-sky-400 underline">영상 만들러 가기</Link></div>
          </div>
        )}

        <div className="space-y-4">
          {items.map((it) => (
            <div key={it.id} className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex flex-col sm:flex-row gap-4">
              <div className="w-full sm:w-40 flex-shrink-0">
                {it.videoUrl ? (
                  <video src={it.videoUrl} controls playsInline preload="metadata" className="w-full rounded-xl bg-black aspect-[9/16] object-cover" />
                ) : (
                  <div className="w-full rounded-xl bg-neutral-800 aspect-[9/16] flex items-center justify-center text-xs text-neutral-500">
                    {STATUS_LABEL[it.status] || it.status} {it.progress ? `${it.progress}%` : ''}
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate">{it.title}</h3>
                    {it.catchphrase && <p className="text-xs text-neutral-400 truncate">{it.catchphrase}</p>}
                  </div>
                  <span className="text-[11px] text-neutral-500 shrink-0">{fmtDate(it.createdAt)}</span>
                </div>
                {it.error && <p className="text-xs text-red-400 mt-1">{it.error}</p>}

                <div className="mt-auto pt-3 flex flex-wrap gap-2">
                  {it.videoUrl && (
                    <a href={it.videoUrl} download={`${it.title}_홍보영상.mp4`}
                      className="text-xs bg-neutral-800 hover:bg-neutral-700 rounded-lg px-3 py-2">⬇ 다운로드</a>
                  )}
                  {it.videoUrl && it.youtubeUrl && (
                    <>
                      <button onClick={() => copyLink(it)} className="text-xs bg-red-600 hover:bg-red-500 text-white rounded-lg px-3 py-2">🔗 링크 복사</button>
                      <a href={it.youtubeUrl} target="_blank" rel="noreferrer" className="text-xs text-sky-400 underline self-center">유튜브에서 보기</a>
                    </>
                  )}
                  {it.videoUrl && !it.youtubeUrl && ytConnected && (
                    <button onClick={() => publish(it)} disabled={busyId === it.id}
                      className="text-xs bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg px-3 py-2">
                      {busyId === it.id ? '올리는 중...' : '▶ 유튜브에 올려 링크 받기'}
                    </button>
                  )}
                  {it.videoUrl && it.instagramUrl && (
                    <a href={it.instagramUrl} target="_blank" rel="noreferrer" className="text-xs text-pink-400 underline self-center">인스타에서 보기</a>
                  )}
                  {it.videoUrl && !it.instagramUrl && igConnected && (
                    <button onClick={() => publishInstagram(it)} disabled={igBusyId === it.id}
                      className="text-xs bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white rounded-lg px-3 py-2">
                      {igBusyId === it.id ? '올리는 중...' : '📸 인스타 릴스로'}
                    </button>
                  )}
                  {it.description && (
                    <button onClick={() => copyDesc(it)} className="text-xs bg-neutral-800 hover:bg-neutral-700 rounded-lg px-3 py-2">📋 설명 복사</button>
                  )}
                  <button onClick={() => remove(it)} disabled={busyId === it.id}
                    className="text-xs text-neutral-400 hover:text-red-400 rounded-lg px-3 py-2 ml-auto">삭제</button>
                </div>
                {it.tags && it.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="text-[11px] text-neutral-500 mr-1">🏷 태그(발행 시 자동):</span>
                    {it.tags.map((t) => (
                      <span key={t} className="text-[11px] text-neutral-300 bg-neutral-800 rounded px-1.5 py-0.5">{t}</span>
                    ))}
                  </div>
                )}
                {msg[it.id] && <div className="text-[11px] text-neutral-300 mt-2 break-all">{msg[it.id]}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
