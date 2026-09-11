'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { BGM_CATALOG } from '@/lib/bgm-catalog';

interface HookScene { text: string; imgPrompt?: string; pose?: string; face?: string; prop?: string; item?: boolean; itemLabel?: string }
interface Slot {
  kind: 'hook' | 'promo' | 'cta';
  pains?: string[];
  question?: string;
  scenes?: HookScene[];
  caption?: string;
  price?: string;
  narration: string;
  mediaUrl?: string;
  mediaFile?: File | null;
}

const VOICES = [
  { v: 'nova', label: '민지 (여·자연)' },
  { v: 'shimmer', label: '수아 (여·활기)' },
  { v: 'echo', label: '준호 (남·자연)' },
];
const inp = 'w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-100 text-sm';

export default function RealAdStudioPage() {
  const { data: session, status } = useSession();
  const isAdmin = !!(session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;

  const [productName, setProductName] = useState('');
  const [price, setPrice] = useState('');
  const [brandName, setBrandName] = useState('homeezion');
  const [voice, setVoice] = useState('nova');
  const [bgmId, setBgmId] = useState('phonk');
  const [html, setHtml] = useState('');

  const [images, setImages] = useState<string[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [videoUrl, setVideoUrl] = useState('');

  async function makeDraft() {
    setErr(''); setVideoUrl(''); setDrafting(true);
    try {
      const r = await fetch('/api/real-ad/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, productName, price }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '초안 생성 실패');
      setImages(d.images || []);
      const imgs: string[] = d.images || [];
      let gi = 0;
      const us: Slot[] = (d.draft.slots || []).map((s: { kind: string; lines: string[]; question?: string; scenes?: HookScene[]; price?: string; narration: string }) => {
        if (s.kind === 'hook') return { kind: 'hook', pains: s.lines, question: s.question, scenes: s.scenes, narration: s.narration };
        const mediaUrl = imgs[gi++ % (imgs.length || 1)];
        return { kind: s.kind as 'promo' | 'cta', caption: (s.lines || [])[0] || '', price: s.price, narration: s.narration, mediaUrl };
      });
      setSlots(us);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setDrafting(false); }
  }

  function patch(i: number, p: Partial<Slot>) { setSlots((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x))); }

  async function generate() {
    setErr(''); setVideoUrl(''); setBusy(true);
    try {
      const metaSlots = slots.map((s) => s.kind === 'hook'
        ? { kind: 'hook', lines: (s.pains || []).filter(Boolean), question: s.question, scenes: s.scenes, narration: s.narration }
        : { kind: s.kind, lines: [s.caption || ''], priceText: s.price, narration: s.narration, hasMedia: !!s.mediaFile, mediaUrl: s.mediaFile ? undefined : s.mediaUrl });
      const fd = new FormData();
      fd.append('meta', JSON.stringify({ slots: metaSlots, bgmId, voice, brandName, productName }));
      slots.forEach((s, i) => { if (s.mediaFile) fd.append(`media_${i}`, s.mediaFile); });
      const r = await fetch('/api/real-ad', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '생성 실패');
      setVideoUrl(d.videoUrl);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  if (status === 'loading') return <div className="st-page-head"><p className="st-sub">로딩…</p></div>;
  if (!isAdmin) return <div className="st-page-head"><h1 className="st-title">접근 불가</h1><p className="st-sub">관리자 전용 페이지입니다.</p></div>;

  return (
    <>
      <div className="st-page-head">
        <div className="st-eyebrow">관리자 · AI</div>
        <h1 className="st-title">실사 제품광고 쇼츠</h1>
        <p className="st-sub">상세 HTML 붙여넣기 → 초안 자동생성 → 이미지·문구·훅 수정 → 완성. 실사·팩트만(과장 금지), 숫자 자동 한글화.</p>
      </div>

      <div className="st-toolskin rounded-2xl" style={{ padding: 18 }}>
        <div className="max-w-3xl space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-neutral-400 mb-1">제품명 *</label><input className={inp} value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="리네아 극세사 무릎담요 3장 세트" /></div>
            <div><label className="block text-xs text-neutral-400 mb-1">가격</label><input className={inp} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="15,900원" /></div>
            <div><label className="block text-xs text-neutral-400 mb-1">브랜드명(하단)</label><input className={inp} value={brandName} onChange={(e) => setBrandName(e.target.value)} /></div>
            <div><label className="block text-xs text-neutral-400 mb-1">나레이터</label><select className={inp} value={voice} onChange={(e) => setVoice(e.target.value)}>{VOICES.map((v) => <option key={v.v} value={v.v}>{v.label}</option>)}</select></div>
            <div className="col-span-2"><label className="block text-xs text-neutral-400 mb-1">배경음악</label><select className={inp} value={bgmId} onChange={(e) => setBgmId(e.target.value)}>{BGM_CATALOG.map((b) => <option key={b.id} value={b.id}>{b.emoji} {b.label} — {b.desc}</option>)}</select></div>
          </div>

          <div>
            <label className="block text-xs text-neutral-400 mb-1">상세페이지 HTML</label>
            <textarea className={`${inp} font-mono text-xs`} rows={5} value={html} onChange={(e) => setHtml(e.target.value)} placeholder="<div ...>상세페이지 HTML 전체 붙여넣기</div>" />
            <button onClick={makeDraft} disabled={drafting || !html || !productName} className="mt-2 w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold">
              {drafting ? '초안 생성 중… (AI 스크립트 + 이미지 추출)' : '① 초안 자동 생성'}
            </button>
          </div>

          {images.length > 0 && (
            <p className="text-xs text-neutral-500">추출 이미지 {images.length}장 — 각 슬롯에서 클릭해 배정/변경하세요.</p>
          )}

          {slots.map((s, i) => (
            <section key={i} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-2">
              {s.kind === 'hook' ? (
                <>
                  <h2 className="font-semibold text-red-400">훅 (AI 일러스트 장면)</h2>
                  <p className="text-xs text-neutral-500">고민 문구 + 일러스트 프롬프트(영어). 캐릭터는 첫 장면 기준으로 일관 생성됩니다.</p>
                  {(s.scenes && s.scenes.length ? s.scenes : (s.pains || []).map((t) => ({ text: t } as HookScene))).map((sc, k) => (
                    <div key={k} className="space-y-1 border-t border-neutral-800 pt-2">
                      <input className={inp} value={sc.text} onChange={(e) => { const arr = [...(s.scenes || [])]; arr[k] = { ...sc, text: e.target.value }; patch(i, { scenes: arr, pains: arr.map((x) => x.text) }); }} placeholder={`고민 ${k + 1}`} />
                      <textarea className={`${inp} text-xs`} rows={2} value={sc.imgPrompt || ''} onChange={(e) => { const arr = [...(s.scenes || [])]; arr[k] = { ...sc, imgPrompt: e.target.value }; patch(i, { scenes: arr }); }} placeholder="일러스트 프롬프트 (영어) — 캐릭터 동작·감정" />
                    </div>
                  ))}
                  <input className={inp} value={s.question || ''} onChange={(e) => patch(i, { question: e.target.value })} placeholder="펀치라인 질문" />
                </>
              ) : (
                <>
                  <h2 className="font-semibold">{s.kind === 'cta' ? 'CTA' : `슬롯 ${i}`}</h2>
                  <input className={inp} value={s.caption || ''} onChange={(e) => patch(i, { caption: e.target.value })} placeholder="자막" />
                  {s.kind === 'cta' && <input className={inp} value={s.price || ''} onChange={(e) => patch(i, { price: e.target.value })} placeholder="가격 (예: 15,900원)" />}
                  <div className="flex gap-1.5 overflow-x-auto py-1">
                    {images.map((u) => (
                      <img key={u} src={u} onClick={() => patch(i, { mediaUrl: u, mediaFile: null })}
                        className={`h-16 w-16 object-cover rounded cursor-pointer shrink-0 border-2 ${s.mediaUrl === u && !s.mediaFile ? 'border-emerald-400' : 'border-transparent'}`} />
                    ))}
                  </div>
                  <input type="file" accept="image/*,video/*" className={inp} onChange={(e) => patch(i, { mediaFile: e.target.files?.[0] ?? null })} />
                </>
              )}
              <textarea className={inp} rows={2} value={s.narration} onChange={(e) => patch(i, { narration: e.target.value })} placeholder="나레이션" />
            </section>
          ))}

          {slots.length > 0 && (
            <button onClick={generate} disabled={busy} className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-neutral-950 font-semibold">
              {busy ? '영상 생성 중… (1~2분)' : '② 영상 완성'}
            </button>
          )}
          {err && <p className="text-red-400 text-sm">{err}</p>}
          {videoUrl && (
            <div className="space-y-2">
              <video src={videoUrl} controls className="w-[280px] rounded-xl mx-auto" style={{ aspectRatio: '9/16' }} />
              <a href={videoUrl} download className="block text-center text-sm text-emerald-400">다운로드</a>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
