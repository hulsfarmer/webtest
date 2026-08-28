'use client';

import { useState, useEffect } from 'react';

interface DesignSet { style: string; banner: string; profile: string; bannerSvg: string; profileSvg: string }

// 스타일 목록(라벨) — 서버 lib과 id 일치. 설명은 고를 때 감 잡으라고.
const STYLE_OPTIONS = [
  { id: 'left', label: '좌측 미니멀', desc: '왼쪽 정렬 · 딥 배경 · 넉넉한 여백' },
  { id: 'center', label: '센터 임팩트', desc: '가운데 정렬 · 좌우 대칭 · 균형' },
  { id: 'colorblock', label: '컬러 블록', desc: '강한 단색 패널 위 텍스트 · 볼드' },
  { id: 'bigtype', label: '빅 타이포', desc: '큰 타이포 중심 · 에디토리얼' },
  { id: 'split', label: '대각 스플릿', desc: '대각선 분할 · 다이내믹 대비' },
  { id: 'glass', label: '글래스 카드', desc: '반투명 카드 · 글래스모피즘' },
];

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
  const [style, setStyle] = useState('left');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sets, setSets] = useState<DesignSet[]>([]);
  const [refineText, setRefineText] = useState<Record<number, string>>({});
  const [refineBusy, setRefineBusy] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<Record<number, string>>({}); // 세트 index → 저장된 assets id
  const [savingIdx, setSavingIdx] = useState<number | null>(null);

  // 라이브러리 '배너' 수정으로 진입 → 저장된 세트를 불러와 편집 시작
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('editBanner');
      if (!raw) return;
      sessionStorage.removeItem('editBanner');
      const o = JSON.parse(raw) as { id: string; title?: string; image: string; meta?: { bannerSvg?: string; profileSvg?: string; profile?: string } };
      if (!o.meta?.bannerSvg || !o.meta?.profileSvg) return;
      setBrandName((o.title || '').split(' · ')[0] || '');
      setSets([{ style: (o.title || '').split(' · ')[1] || '저장된 디자인', banner: o.image, profile: o.meta.profile || o.image, bannerSvg: o.meta.bannerSvg, profileSvg: o.meta.profileSvg }]);
      setSavedId({ 0: o.id }); // 이후 저장은 이 항목을 갱신(PATCH)
    } catch { /* ignore */ }
  }, []);

  async function saveToLibrary(i: number) {
    const s = sets[i];
    setSavingIdx(i); setErr('');
    try {
      const existing = savedId[i];
      const payload = {
        type: 'banner' as const,
        title: `${brandName || '유튜브'} · ${s.style}`.slice(0, 80),
        image: s.banner,
        meta: { bannerSvg: s.bannerSvg, profileSvg: s.profileSvg, profile: s.profile },
      };
      const r = existing
        ? await fetch('/api/assets', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: existing, image: s.banner, title: payload.title, meta: payload.meta }) })
        : await fetch('/api/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '저장 실패');
      if (d.id) setSavedId((p) => ({ ...p, [i]: d.id }));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setSavingIdx(null); }
  }

  async function refine(i: number) {
    const instruction = (refineText[i] || '').trim();
    if (!instruction) return;
    setRefineBusy(i); setErr('');
    try {
      const r = await fetch('/api/youtube/banner-refine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bannerSvg: sets[i].bannerSvg, profileSvg: sets[i].profileSvg, instruction }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '수정 실패');
      setSets((prev) => prev.map((s, j) => (j === i ? d.set : s)));
      setRefineText((prev) => ({ ...prev, [i]: '' }));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setRefineBusy(null); }
  }

  async function generate() {
    if (!brandName.trim()) { setErr('채널/브랜드 이름을 입력하세요.'); return; }
    setBusy(true); setErr(''); setSets([]);
    try {
      const r = await fetch('/api/youtube/banner-set', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandName, headline, tagline, colors, vibe, style }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '생성 실패');
      setSets(d.set ? [d.set] : []);
      setSavedId({});
      if (!d.set) setErr('생성된 디자인이 없어요. 다시 시도해주세요.');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const slug = (brandName || 'youtube').replace(/[^a-zA-Z0-9가-힣_-]/g, '_').slice(0, 40);
  const downloadSet = (s: DesignSet, i: number) => {
    download(s.banner, `${slug}_배너_${i + 1}.png`);
    setTimeout(() => download(s.profile, `${slug}_프로필_${i + 1}.png`), 500);
  };

  return (
    <div className="lgm">
      <div className="header">
        <h1>유튜브 배너·프로필 세트 <span className="badge">AI 디자인</span></h1>
        <p>브랜드 정보와 스타일만 고르면 <b>배너(2048×1152) + 프로필(800×800)</b>을 통일감 있게 디자인해 드려요. 다운로드·AI 수정·라이브러리 저장까지 한곳에서.</p>
      </div>

      <div className="grid">
        {/* 좌: 입력 */}
        <div className="card">
          <div className="field">
            <label>채널/브랜드 이름 *</label>
            <input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="이지온" />
          </div>
          <div className="field">
            <label>배너 큰 문구</label>
            <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="복잡함은 끄고, 쉬움을 켭니다" />
          </div>
          <div className="field">
            <label>스타일</label>
            <select value={style} onChange={(e) => setStyle(e.target.value)}>
              {STYLE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <p className="hint" style={{ marginTop: 6 }}>{STYLE_OPTIONS.find((o) => o.id === style)?.desc}</p>
          </div>
          <div className="row">
            <div className="field">
              <label>보조 문구</label>
              <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="누구나 쉽게 만드는 콘텐츠 스튜디오" />
            </div>
            <div className="field">
              <label>선호 색 (선택)</label>
              <input value={colors} onChange={(e) => setColors(e.target.value)} placeholder="딥네이비 · 시안 · 민트" />
            </div>
          </div>
          <div className="field">
            <label>분위기 / 업종 (선택)</label>
            <input value={vibe} onChange={(e) => setVibe(e.target.value)} placeholder="AI 콘텐츠 제작, 깔끔하고 신뢰감 있는" />
          </div>
          <button className="primary" onClick={generate} disabled={busy}>
            {busy ? 'AI가 디자인 중… (15~30초)' : '✨ 배너·프로필 생성 · 1크레딧'}
          </button>
          {err && <div className="error">{err}</div>}
          <p className="hint" style={{ marginTop: 8 }}>고른 스타일로 배너+프로필 1세트가 나오고 1크레딧이 소모돼요. 마음에 안 들면 스타일을 바꿔 다시 생성하거나, 아래에서 AI 수정할 수 있어요.</p>
        </div>

        {/* 우: 결과 */}
        <div className="card results">
          {!sets.length && !busy && (
            <p className="hint" style={{ marginTop: 0 }}>왼쪽에서 브랜드 정보·스타일을 고르고 <b>생성</b>을 누르면, 배너+프로필이 여기에 나와요.</p>
          )}
          {busy && <p className="hint" style={{ marginTop: 0 }}>디자인을 그리는 중이에요…</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {sets.map((s, i) => (
              <div key={i} style={{ border: '1px solid var(--line, #2a2a2a)', borderRadius: 14, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#34d399', marginBottom: 10 }}>{s.style}</div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.banner} alt={`배너 ${i + 1}`} style={{ flex: '1 1 320px', minWidth: 240, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }} />
                  <div style={{ textAlign: 'center' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.profile} alt={`프로필 ${i + 1}`} style={{ width: 96, height: 96, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.08)', objectFit: 'cover' }} />
                    <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>프로필</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="primary" style={{ flex: 1 }} onClick={() => downloadSet(s, i)}>
                    ⬇ 다운로드 (배너+프로필)
                  </button>
                  <button onClick={() => saveToLibrary(i)} disabled={savingIdx === i}
                    style={{ whiteSpace: 'nowrap', background: '#334155', color: '#fff', border: 'none', borderRadius: 8, padding: '0 14px', fontSize: 13, cursor: 'pointer', opacity: savingIdx === i ? 0.6 : 1 }}>
                    {savingIdx === i ? '저장 중…' : savedId[i] ? '✓ 저장됨' : '💾 라이브러리 저장'}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <input
                    value={refineText[i] || ''}
                    onChange={(e) => setRefineText((p) => ({ ...p, [i]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') refine(i); }}
                    placeholder="✏️ 수정 요청 (예: 색을 초록으로, 문구를 ~로)"
                    disabled={refineBusy === i}
                    style={{ flex: 1, background: 'var(--bg2, #0e0e0e)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '8px 10px', color: 'inherit', fontSize: 13 }}
                  />
                  <button onClick={() => refine(i)} disabled={refineBusy === i || !(refineText[i] || '').trim()}
                    style={{ whiteSpace: 'nowrap', background: '#334155', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 13, cursor: 'pointer', opacity: refineBusy === i ? 0.6 : 1 }}>
                    {refineBusy === i ? '수정 중…' : '수정 · 1C'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
