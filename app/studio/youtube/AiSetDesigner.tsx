'use client';

import { useState } from 'react';

interface DesignSet { style: string; banner: string; profile: string }

const inputCls =
  'w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2.5 text-sm text-neutral-100 placeholder-neutral-600 focus:border-emerald-500 focus:outline-none';

function download(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

export default function AiSetDesigner() {
  const [brandName, setBrandName] = useState('');
  const [headline, setHeadline] = useState('');
  const [tagline, setTagline] = useState('');
  const [colors, setColors] = useState('');
  const [vibe, setVibe] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sets, setSets] = useState<DesignSet[]>([]);

  async function generate() {
    if (!brandName.trim()) { setErr('브랜드/채널 이름을 입력하세요.'); return; }
    setBusy(true); setErr(''); setSets([]);
    try {
      const r = await fetch('/api/youtube/banner-set', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandName, headline, tagline, colors, vibe }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '생성 실패');
      setSets(d.sets || []);
      if (!d.sets?.length) setErr('생성된 디자인이 없어요. 다시 시도해주세요.');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const slug = (brandName || 'youtube').replace(/[^a-zA-Z0-9가-힣_-]/g, '_').slice(0, 40);

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 mb-6">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-neutral-100">유튜브 배너·프로필 세트 <span className="text-xs font-normal text-emerald-400">AI 디자인</span></h2>
        <p className="text-xs text-neutral-500 mt-1">브랜드 정보만 넣으면 <b className="text-neutral-300">배너(2048×1152)+프로필(800×800)</b>을 통일감 있는 3가지 방향으로 디자인해 드려요. 마음에 드는 세트를 골라 다운로드하세요.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-sm text-neutral-300 mb-1.5">채널/브랜드 이름 *</label>
          <input className={inputCls} value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="이지온" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm text-neutral-300 mb-1.5">배너 큰 문구</label>
          <input className={inputCls} value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="복잡함은 끄고, 쉬움을 켭니다" />
        </div>
        <div>
          <label className="block text-sm text-neutral-300 mb-1.5">보조 문구</label>
          <input className={inputCls} value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="누구나 쉽게 만드는 콘텐츠 스튜디오" />
        </div>
        <div>
          <label className="block text-sm text-neutral-300 mb-1.5">선호 색 (선택)</label>
          <input className={inputCls} value={colors} onChange={(e) => setColors(e.target.value)} placeholder="딥네이비 · 시안 · 민트" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm text-neutral-300 mb-1.5">분위기/업종 (선택)</label>
          <input className={inputCls} value={vibe} onChange={(e) => setVibe(e.target.value)} placeholder="AI 콘텐츠 제작, 깔끔하고 신뢰감 있는" />
        </div>
      </div>

      <button onClick={generate} disabled={busy}
        className="mt-4 w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-neutral-950 font-semibold rounded-lg py-3">
        {busy ? 'AI가 3가지 방향을 디자인 중… (20~40초)' : '✨ 배너·프로필 세트 생성'}
      </button>
      {err && <p className="text-sm text-red-400 mt-2">{err}</p>}

      {sets.length > 0 && (
        <div className="mt-6 space-y-6">
          {sets.map((s, i) => (
            <div key={i} className="border border-neutral-800 rounded-xl p-4 bg-neutral-950/40">
              <div className="text-sm font-semibold text-emerald-300 mb-3">방향 {i + 1} · {s.style}</div>
              <div className="flex flex-col md:flex-row gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.banner} alt={`배너 ${i + 1}`} className="w-full md:flex-1 rounded-lg border border-neutral-800" />
                <div className="flex md:flex-col items-center gap-3 md:w-40 shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.profile} alt={`프로필 ${i + 1}`} className="w-28 h-28 rounded-full border border-neutral-800 object-cover" />
                  <div className="text-[11px] text-neutral-500">프로필 (원형 크롭 미리보기)</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button onClick={() => download(s.banner, `${slug}_banner_${i + 1}.png`)}
                  className="text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-100 rounded-lg px-3 py-2">⬇ 배너 다운로드</button>
                <button onClick={() => download(s.profile, `${slug}_profile_${i + 1}.png`)}
                  className="text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-100 rounded-lg px-3 py-2">⬇ 프로필 다운로드</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
