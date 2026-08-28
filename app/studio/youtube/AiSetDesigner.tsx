'use client';

import { useState } from 'react';

interface DesignSet { style: string; banner: string; profile: string; bannerSvg: string; profileSvg: string }

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
  const [refineText, setRefineText] = useState<Record<number, string>>({});
  const [refineBusy, setRefineBusy] = useState<number | null>(null);

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
  const downloadSet = (s: DesignSet, i: number) => {
    download(s.banner, `${slug}_배너_${i + 1}.png`);
    setTimeout(() => download(s.profile, `${slug}_프로필_${i + 1}.png`), 500);
  };

  return (
    <div className="lgm">
      <div className="header">
        <h1>유튜브 배너·프로필 세트 <span className="badge">AI 디자인</span></h1>
        <p>브랜드 정보만 넣으면 <b>배너(2048×1152) + 프로필(800×800)</b>을 통일감 있는 3가지 방향으로 디자인해 드려요. 마음에 드는 세트를 골라 한 번에 다운로드하세요.</p>
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
            {busy ? 'AI가 3가지 방향을 디자인 중… (20~40초)' : '✨ 배너·프로필 세트 생성 · 2크레딧'}
          </button>
          {err && <div className="error">{err}</div>}
          <p className="hint" style={{ marginTop: 8 }}>1회 생성에 3가지 세트가 나오고 2크레딧이 소모돼요. 유튜브 안전영역·규격에 맞춰 자동 배치됩니다.</p>
        </div>

        {/* 우: 결과 */}
        <div className="card results">
          {!sets.length && !busy && (
            <p className="hint" style={{ marginTop: 0 }}>왼쪽에 브랜드 정보를 넣고 <b>생성</b>을 누르면, 3가지 디자인 방향이 여기에 배너+프로필 세트로 나와요.</p>
          )}
          {busy && <p className="hint" style={{ marginTop: 0 }}>디자인을 그리는 중이에요…</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {sets.map((s, i) => (
              <div key={i} style={{ border: '1px solid var(--line, #2a2a2a)', borderRadius: 14, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#34d399', marginBottom: 10 }}>방향 {i + 1} · {s.style}</div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.banner} alt={`배너 ${i + 1}`} style={{ flex: '1 1 320px', minWidth: 240, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }} />
                  <div style={{ textAlign: 'center' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.profile} alt={`프로필 ${i + 1}`} style={{ width: 96, height: 96, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.08)', objectFit: 'cover' }} />
                    <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>프로필</div>
                  </div>
                </div>
                <button className="primary" style={{ marginTop: 12 }} onClick={() => downloadSet(s, i)}>
                  ⬇ 이 세트 다운로드 (배너+프로필)
                </button>
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
