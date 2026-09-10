'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { BGM_CATALOG } from '@/lib/bgm-catalog';

type Media = File | null;
interface Promo { title: string; badge: string; narration: string; media: Media; }

const VOICES = [
  { v: 'nova', label: '민지 (여·자연)' },
  { v: 'shimmer', label: '수아 (여·활기)' },
  { v: 'echo', label: '준호 (남·자연)' },
];
const inputCls = 'w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-100 text-sm';

export default function RealAdAdminPage() {
  const { data: session, status } = useSession();
  const isAdmin = !!(session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;

  const [brandName, setBrandName] = useState('');
  const [bgmId, setBgmId] = useState('energetic');
  const [voice, setVoice] = useState('nova');

  // 훅
  const [pains, setPains] = useState(['미끄럽고…', '흡수 안 되고…', '세탁도 어렵고…']);
  const [question, setQuestion] = useState('아직도 이런 발매트를 사용하세요?');
  const [hookNarr, setHookNarr] = useState('');

  // 제품등장 + 홍보들
  const [reveal, setReveal] = useState<Promo>({ title: '', badge: 'NEW', narration: '', media: null });
  const [promos, setPromos] = useState<Promo[]>([
    { title: '', badge: '', narration: '', media: null },
    { title: '', badge: '', narration: '', media: null },
    { title: '', badge: '', narration: '', media: null },
  ]);

  // CTA
  const [ctaTitle, setCtaTitle] = useState('');
  const [ctaPrice, setCtaPrice] = useState('');
  const [ctaNarr, setCtaNarr] = useState('');
  const [ctaMedia, setCtaMedia] = useState<Media>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [videoUrl, setVideoUrl] = useState('');

  function setPromo(i: number, patch: Partial<Promo>) {
    setPromos((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  }
  function addPromo() { if (promos.length < 4) setPromos((ps) => [...ps, { title: '', badge: '', narration: '', media: null }]); }
  function removePromo(i: number) { if (promos.length > 1) setPromos((ps) => ps.filter((_, j) => j !== i)); }

  async function generate() {
    setErr(''); setVideoUrl(''); setBusy(true);
    try {
      const slots: Record<string, unknown>[] = [];
      const files: (Media)[] = [];

      // 1) 훅
      slots.push({ kind: 'hook', lines: pains.filter(Boolean), question: question.trim() || undefined,
        narration: (hookNarr.trim() || [...pains.filter(Boolean), question].join(', ')) });
      files.push(null);

      // 2) 제품 등장
      slots.push({ kind: 'promo', lines: [reveal.title || '제품'], badge: reveal.badge || undefined,
        narration: reveal.narration || reveal.title, hasMedia: !!reveal.media });
      files.push(reveal.media);

      // 3) 홍보들
      for (const p of promos) {
        if (!p.title && !p.media) continue;
        slots.push({ kind: 'promo', lines: [p.title], badge: p.badge || undefined,
          narration: p.narration || p.title, hasMedia: !!p.media });
        files.push(p.media);
      }

      // 4) CTA
      slots.push({ kind: 'cta', lines: [ctaTitle || '지금 만나보세요'], priceText: ctaPrice || undefined,
        narration: ctaNarr || ctaPrice || ctaTitle, hasMedia: !!ctaMedia });
      files.push(ctaMedia);

      const meta = { slots, bgmId, voice, brandName };
      const fd = new FormData();
      fd.append('meta', JSON.stringify(meta));
      files.forEach((f, i) => { if (f) fd.append(`media_${i}`, f); });

      const r = await fetch('/api/real-ad', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '생성 실패');
      setVideoUrl(d.videoUrl);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  if (status === 'loading') return <div className="p-8 text-neutral-400">로딩…</div>;
  if (!isAdmin) return <div className="p-8 text-red-400">관리자 전용 페이지입니다.</div>;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-4 py-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">실사 제품광고 쇼츠 <span className="text-sm text-amber-400">관리자</span></h1>
          <p className="text-sm text-neutral-400 mt-1">훅 → 제품등장 → 홍보1~4 → CTA. 각 칸에 문구·미디어(이미지/영상)·나레이션. 실사 소재만 쓰세요(과장 금지).</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs text-neutral-400 mb-1">브랜드명(하단)</label><input className={inputCls} value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="homeezion" /></div>
          <div><label className="block text-xs text-neutral-400 mb-1">나레이터</label><select className={inputCls} value={voice} onChange={(e) => setVoice(e.target.value)}>{VOICES.map((v) => <option key={v.v} value={v.v}>{v.label}</option>)}</select></div>
          <div className="col-span-2"><label className="block text-xs text-neutral-400 mb-1">배경음악</label><select className={inputCls} value={bgmId} onChange={(e) => setBgmId(e.target.value)}>{BGM_CATALOG.map((b) => <option key={b.id} value={b.id}>{b.emoji} {b.label} — {b.desc}</option>)}</select></div>
        </div>

        {/* 훅 */}
        <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-2">
          <h2 className="font-semibold text-red-400">훅 (고민 빌드업)</h2>
          {pains.map((p, i) => (
            <input key={i} className={inputCls} value={p} onChange={(e) => setPains((ps) => ps.map((x, j) => j === i ? e.target.value : x))} placeholder={`고민 ${i + 1}`} />
          ))}
          <input className={inputCls} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="펀치라인 질문" />
          <input className={inputCls} value={hookNarr} onChange={(e) => setHookNarr(e.target.value)} placeholder="나레이션(비우면 자동)" />
        </section>

        {/* 제품 등장 */}
        <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-2">
          <h2 className="font-semibold">제품 등장</h2>
          <input className={inputCls} value={reveal.title} onChange={(e) => setReveal({ ...reveal, title: e.target.value })} placeholder="제품명 (예: 3세대 규조토 발매트)" />
          <div className="flex gap-2">
            <input className={inputCls} value={reveal.badge} onChange={(e) => setReveal({ ...reveal, badge: e.target.value })} placeholder="배지 (예: NEW)" />
            <input type="file" accept="image/*,video/*" className={inputCls} onChange={(e) => setReveal({ ...reveal, media: e.target.files?.[0] ?? null })} />
          </div>
          <input className={inputCls} value={reveal.narration} onChange={(e) => setReveal({ ...reveal, narration: e.target.value })} placeholder="나레이션(비우면 제품명)" />
        </section>

        {/* 홍보들 */}
        {promos.map((p, i) => (
          <section key={i} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-2">
            <div className="flex justify-between items-center"><h2 className="font-semibold">홍보 {i + 1}</h2>{promos.length > 1 && <button onClick={() => removePromo(i)} className="text-xs text-neutral-500 hover:text-red-400">삭제</button>}</div>
            <input className={inputCls} value={p.title} onChange={(e) => setPromo(i, { title: e.target.value })} placeholder="제목 (예: 물기 쫙~ 흡수)" />
            <div className="flex gap-2">
              <input className={inputCls} value={p.badge} onChange={(e) => setPromo(i, { badge: e.target.value })} placeholder="배지 (선택)" />
              <input type="file" accept="image/*,video/*" className={inputCls} onChange={(e) => setPromo(i, { media: e.target.files?.[0] ?? null })} />
            </div>
            <input className={inputCls} value={p.narration} onChange={(e) => setPromo(i, { narration: e.target.value })} placeholder="나레이션(비우면 제목)" />
          </section>
        ))}
        {promos.length < 4 && <button onClick={addPromo} className="text-sm px-3 py-2 rounded-lg border border-neutral-700 text-neutral-300 hover:bg-neutral-800">+ 홍보 추가</button>}

        {/* CTA */}
        <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-2">
          <h2 className="font-semibold text-emerald-400">CTA</h2>
          <input className={inputCls} value={ctaTitle} onChange={(e) => setCtaTitle(e.target.value)} placeholder="제목 (예: 3세대 규조토 발매트)" />
          <div className="flex gap-2">
            <input className={inputCls} value={ctaPrice} onChange={(e) => setCtaPrice(e.target.value)} placeholder="가격 (예: 지금 17,900원)" />
            <input type="file" accept="image/*,video/*" className={inputCls} onChange={(e) => setCtaMedia(e.target.files?.[0] ?? null)} />
          </div>
          <input className={inputCls} value={ctaNarr} onChange={(e) => setCtaNarr(e.target.value)} placeholder="나레이션" />
        </section>

        <button onClick={generate} disabled={busy} className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-neutral-950 font-semibold">
          {busy ? '생성 중… (30~90초)' : '영상 생성'}
        </button>
        {err && <p className="text-red-400 text-sm">{err}</p>}
        {videoUrl && (
          <div className="space-y-2">
            <video src={videoUrl} controls className="w-[280px] rounded-xl mx-auto" style={{ aspectRatio: '9/16' }} />
            <a href={videoUrl} download className="block text-center text-sm text-emerald-400">다운로드</a>
          </div>
        )}
      </div>
    </div>
  );
}
