'use client';

import { useState, useRef } from 'react';

const VOICES = [
  { id: 'ko-KR-Chirp3-HD-Aoede', label: '지은 (여·자연스러운)' },
  { id: 'ko-KR-Chirp3-HD-Zephyr', label: '수아 (여·활기찬)' },
  { id: 'ko-KR-Chirp3-HD-Charon', label: '민준 (남·자연스러운)' },
];
const PRESETS = [{ id: 'preset-jieun', label: '지은', src: '/characters/preset-jieun.png' }];
type StepState = 'pending' | 'running' | 'done' | 'failed';
type Section = { type: 'hook' | 'main' | 'cta'; label: string; text: string };

export default function PromoCharacterPage() {
  const [phase, setPhase] = useState<'form' | 'script'>('form');
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [sellingPoints, setSellingPoints] = useState('');
  const [cta, setCta] = useState('');
  const [voice, setVoice] = useState(VOICES[0].id);
  const [duration, setDuration] = useState('20');
  const [preset, setPreset] = useState('preset-jieun');
  const [charFile, setCharFile] = useState<File | null>(null);
  const [charPreview, setCharPreview] = useState('');
  const [productFile, setProductFile] = useState<File | null>(null);
  const [productPreview, setProductPreview] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importedImagePath, setImportedImagePath] = useState(''); // /imports/xxx
  const [importNote, setImportNote] = useState('');

  const [sections, setSections] = useState<Section[]>([]);
  const [scriptBusy, setScriptBusy] = useState(false);

  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [steps, setSteps] = useState<{ script: StepState; audio: StepState; video: StepState }>({ script: 'pending', audio: 'pending', video: 'pending' });
  const [videoUrl, setVideoUrl] = useState('');
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputCls = 'w-full bg-neutral-950 border border-neutral-700 rounded-lg p-2.5 text-sm';

  function onProduct(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null; setProductFile(f); setProductPreview(f ? URL.createObjectURL(f) : ''); if (f) setImportedImagePath('');
  }

  // 제품 링크에서 제품명·홍보소재·이미지 자동 추출
  async function onImport() {
    setError('');
    if (!/^https?:\/\//i.test(importUrl.trim())) { setError('올바른 상품 URL을 입력하세요.'); return; }
    setImportBusy(true);
    try {
      const r = await fetch('/api/promo-character/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '불러오기 실패');
      if (d.title) setBusinessName(d.title);
      if (d.description) setSellingPoints(d.description);
      if (d.imageUrl) { setProductPreview(d.imageUrl); setImportedImagePath(d.imageUrl); setProductFile(null); }
      const got = [d.title && '제품명', d.imageUrl && '이미지', d.description && '홍보포인트'].filter(Boolean).join('·');
      const tail = d.descriptionSource === 'images'
        ? '📄 상세페이지 이미지를 읽어 홍보 포인트를 자동 추출했어요 — 사실과 맞는지 확인·수정하세요.'
        : !d.description
          ? '홍보 포인트를 못 찾았어요 — 아래에 제품 핵심 특징을 직접 적어주세요 (대본 품질을 좌우해요).'
          : '내용을 확인·수정한 뒤 진행하세요.';
      setImportNote((got ? `✅ ${got} 불러왔어요. ` : '') + tail);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setImportNote(''); }
    finally { setImportBusy(false); }
  }
  function onChar(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null; setCharFile(f); setCharPreview(f ? URL.createObjectURL(f) : ''); if (f) setPreset('');
  }

  function validateForm(): string | null {
    if (!businessName.trim()) return '제품명을 입력하세요.';
    if (!sellingPoints.trim()) return '홍보 포인트를 입력하세요.';
    if (!productFile && !importedImagePath) return '제품 이미지를 업로드하거나 링크에서 불러오세요.';
    if (!charFile && !preset) return '캐릭터를 선택하거나 업로드하세요.';
    return null;
  }

  // 1단계: AI 대본 생성 → 편집 화면
  async function onGenerateScript() {
    setError('');
    const v = validateForm(); if (v) { setError(v); return; }
    setScriptBusy(true);
    try {
      const r = await fetch('/api/promo-character/script', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessName, businessType, sellingPoints, cta, duration, tone: '친근한' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '대본 생성 실패');
      setSections(d.sections);
      if (d.title && !cta.trim()) { /* 유지 */ }
      setPhase('script');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setScriptBusy(false); }
  }

  // 2단계: 편집된 대본으로 영상 생성
  async function onGenerateVideo() {
    setError(''); setVideoUrl('');
    const fd = new FormData();
    fd.append('businessName', businessName);
    fd.append('businessType', businessType);
    fd.append('sellingPoints', sellingPoints);
    fd.append('cta', cta);
    fd.append('voice', voice);
    fd.append('duration', duration);
    if (productFile) fd.append('product', productFile); else fd.append('productPath', importedImagePath);
    if (charFile) fd.append('character', charFile); else fd.append('preset', preset);
    fd.append('sections', JSON.stringify(sections.map((s) => ({ type: s.type, text: s.text }))));

    setBusy(true); setSteps({ script: 'done', audio: 'running', video: 'pending' });
    setStatusMsg('⏳ 나레이션 음성 생성 중...');
    try {
      const r = await fetch('/api/promo-character', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '생성 실패');
      poll(data.jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setBusy(false);
      setSteps({ script: 'done', audio: 'failed', video: 'pending' });
    }
  }

  function poll(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    const started = Date.now();
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/status/${jobId}`);
        const d = await r.json();
        const secs = Math.round((Date.now() - started) / 1000);
        setSteps({ script: d.steps?.script ?? 'done', audio: d.steps?.audio ?? 'pending', video: d.steps?.video ?? 'pending' });
        if (d.status === 'done' && d.videoUrl) {
          if (pollRef.current) clearInterval(pollRef.current);
          setVideoUrl(d.videoUrl); setStatusMsg(`✅ 완료! (${secs}초)`); setBusy(false);
        } else if (d.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          setError(d.error || '생성 실패'); setStatusMsg(''); setBusy(false);
        } else {
          setStatusMsg(`⏳ 처리 중... (${secs}초 경과 · 캐릭터 영상 생성은 길이에 따라 5~15분 걸립니다)`);
        }
      } catch { /* keep polling */ }
    }, 3000);
  }

  const dot = (s: StepState) => s === 'done' ? '✅' : s === 'running' ? '⏳' : s === 'failed' ? '❌' : '⚪';

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-4 py-10">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold">🛍️ 제품 홍보 캐릭터 영상</h1>
        <p className="text-sm text-neutral-400 mt-1 mb-8">
          제품 정보 → AI 대본(검토·편집) → 캐릭터 홍보 쇼츠 (인트로 → 제품+코너 캐릭터 → 마무리, 상단 제품명 고정)
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          {/* 좌: 입력 or 대본편집 */}
          {phase === 'form' ? (
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4">
              <div className="pb-4 border-b border-neutral-800">
                <label className="block text-sm text-emerald-300 mb-1.5">🔗 제품 링크로 자동 채우기 (선택)</label>
                <div className="flex gap-2">
                  <input className={inputCls} value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="상품 페이지 URL (쿠팡·네이버·자사몰 등)" />
                  <button onClick={onImport} disabled={importBusy}
                    className="shrink-0 px-4 rounded-lg bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 text-sm font-medium">
                    {importBusy ? '불러오는 중' : '불러오기'}
                  </button>
                </div>
                <p className="text-xs text-neutral-500 mt-1.5">쿠팡·네이버 등 상품 링크를 붙여넣으면 제품명·대표이미지를 자동으로 채워요. (안 되면 아래에 직접 입력)</p>
                {importNote && <p className="text-xs text-amber-300/90 mt-1.5">{importNote}</p>}
              </div>
              <div>
                <label className="block text-sm text-neutral-300 mb-1.5">제품명 *</label>
                <input className={inputCls} value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="글로우 세럼" />
              </div>
              <div>
                <label className="block text-sm text-neutral-300 mb-1.5">업종/카테고리</label>
                <input className={inputCls} value={businessType} onChange={(e) => setBusinessType(e.target.value)} placeholder="스킨케어 · 화장품" />
              </div>
              <div>
                <label className="block text-sm text-neutral-300 mb-1.5">홍보 포인트 *</label>
                <textarea className={inputCls} rows={3} value={sellingPoints} onChange={(e) => setSellingPoints(e.target.value)} placeholder="비타민C 20% 고농축, 3주 톤업, 산뜻한 사용감" />
              </div>
              <div>
                <label className="block text-sm text-neutral-300 mb-1.5">CTA (행동 유도)</label>
                <input className={inputCls} value={cta} onChange={(e) => setCta(e.target.value)} placeholder="지금 구매하기   @glowbrand" />
              </div>
              <div>
                <label className="block text-sm text-neutral-300 mb-1.5">제품 이미지 *</label>
                <input type="file" accept="image/*" className={inputCls} onChange={onProduct} />
                {productPreview && <img src={productPreview} alt="product" className="mt-2 w-24 rounded-lg" />}
              </div>
              <div>
                <label className="block text-sm text-neutral-300 mb-1.5">캐릭터(프레젠터)</label>
                <div className="flex gap-3 flex-wrap">
                  {PRESETS.map((p) => (
                    <button key={p.id} onClick={() => { setPreset(p.id); setCharFile(null); setCharPreview(''); }}
                      className={`w-16 h-20 rounded-lg overflow-hidden border-2 ${preset === p.id ? 'border-emerald-400' : 'border-neutral-700'}`}>
                      <img src={p.src} alt={p.label} className="w-full h-full object-cover" />
                    </button>
                  ))}
                  <label className={`w-16 h-20 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer text-xs text-neutral-400 ${charFile ? 'border-emerald-400' : 'border-neutral-700'}`}>
                    {charPreview ? <img src={charPreview} alt="up" className="w-full h-full object-cover rounded-md" /> : <span>+업로드</span>}
                    <input type="file" accept="image/*" className="hidden" onChange={onChar} />
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-neutral-300 mb-1.5">목소리</label>
                  <select className={inputCls} value={voice} onChange={(e) => setVoice(e.target.value)}>
                    {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-neutral-300 mb-1.5">길이(초)</label>
                  <select className={inputCls} value={duration} onChange={(e) => setDuration(e.target.value)}>
                    <option value="15">15초 (빠름)</option>
                    <option value="20">20초</option>
                    <option value="30">30초</option>
                  </select>
                </div>
              </div>
              <button onClick={onGenerateScript} disabled={scriptBusy}
                className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-neutral-950 font-semibold rounded-lg py-3">
                {scriptBusy ? 'AI 대본 생성 중...' : '① AI 대본 생성'}
              </button>
            </div>
          ) : (
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">대본 검토·편집</div>
                <button onClick={() => setPhase('form')} className="text-xs text-neutral-400 hover:text-neutral-200">← 정보 수정</button>
              </div>
              <p className="text-xs text-neutral-500">각 장면에 들어갈 나레이션이에요. 자유롭게 수정하세요. (상단에는 제품명 &quot;{businessName}&quot; 이 고정 표시됩니다)</p>
              {sections.map((s, i) => (
                <div key={s.type}>
                  <label className="block text-sm text-emerald-300 mb-1.5">{s.label}</label>
                  <textarea className={inputCls} rows={2} value={s.text}
                    onChange={(e) => setSections((prev) => prev.map((p, j) => j === i ? { ...p, text: e.target.value } : p))} />
                </div>
              ))}
              <button onClick={onGenerateVideo} disabled={busy}
                className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-neutral-950 font-semibold rounded-lg py-3">
                {busy ? '영상 생성 중...' : '② 이 대본으로 영상 생성'}
              </button>
            </div>
          )}

          {/* 우: 결과 */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
            <div className="text-sm font-semibold mb-3">결과</div>
            <div className="text-sm text-neutral-400 space-y-1 mb-3">
              <div>{dot(steps.script)} 대본</div>
              <div>{dot(steps.audio)} 나레이션 음성 (Chirp3-HD)</div>
              <div>{dot(steps.video)} 캐릭터 영상 + 합성 (Kling)</div>
            </div>
            {statusMsg && <div className="text-sm text-neutral-300 mb-3">{statusMsg}</div>}
            {error && <div className="text-sm text-red-400 mb-3">❌ {error}</div>}
            {videoUrl && <video src={videoUrl} controls autoPlay loop className="w-full max-w-[280px] rounded-xl mx-auto" />}
            {!videoUrl && !error && phase === 'form' && <div className="text-xs text-neutral-500">먼저 제품 정보를 넣고 &quot;AI 대본 생성&quot;을 누르세요.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
