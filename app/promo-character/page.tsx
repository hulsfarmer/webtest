'use client';

import { useState, useRef } from 'react';

const VOICES = [
  { id: 'ko-KR-Chirp3-HD-Aoede', label: '지은 (여·자연스러운)' },
  { id: 'ko-KR-Chirp3-HD-Zephyr', label: '수아 (여·활기찬)' },
  { id: 'ko-KR-Chirp3-HD-Charon', label: '민준 (남·자연스러운)' },
];
const PRESETS = [{ id: 'preset-jieun', label: '지은', src: '/characters/preset-jieun.png' }];
type StepState = 'pending' | 'running' | 'done' | 'failed';

export default function PromoCharacterPage() {
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
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [steps, setSteps] = useState<{ script: StepState; audio: StepState; video: StepState }>({ script: 'pending', audio: 'pending', video: 'pending' });
  const [videoUrl, setVideoUrl] = useState('');
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function onProduct(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setProductFile(f); setProductPreview(f ? URL.createObjectURL(f) : '');
  }
  function onChar(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setCharFile(f); setCharPreview(f ? URL.createObjectURL(f) : ''); if (f) setPreset('');
  }

  async function onGenerate() {
    setError(''); setVideoUrl('');
    if (!businessName.trim()) { setError('제품명을 입력하세요.'); return; }
    if (!sellingPoints.trim()) { setError('홍보 포인트를 입력하세요.'); return; }
    if (!productFile) { setError('제품 이미지를 업로드하세요.'); return; }
    if (!charFile && !preset) { setError('캐릭터를 선택하거나 업로드하세요.'); return; }

    const fd = new FormData();
    fd.append('businessName', businessName);
    fd.append('businessType', businessType);
    fd.append('sellingPoints', sellingPoints);
    fd.append('cta', cta);
    fd.append('voice', voice);
    fd.append('duration', duration);
    fd.append('product', productFile);
    if (charFile) fd.append('character', charFile); else fd.append('preset', preset);

    setBusy(true); setSteps({ script: 'running', audio: 'pending', video: 'pending' });
    setStatusMsg('⏳ AI가 홍보 대본을 쓰는 중...');
    try {
      const r = await fetch('/api/promo-character', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '생성 실패');
      poll(data.jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setBusy(false);
      setSteps({ script: 'failed', audio: 'pending', video: 'pending' });
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
        setSteps({ script: d.steps?.script ?? 'running', audio: d.steps?.audio ?? 'pending', video: d.steps?.video ?? 'pending' });
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
  const inputCls = 'w-full bg-neutral-950 border border-neutral-700 rounded-lg p-2.5 text-sm';

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-4 py-10">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold">🛍️ 제품 홍보 캐릭터 영상</h1>
        <p className="text-sm text-neutral-400 mt-1 mb-8">
          제품 정보만 넣으면 → AI 대본 → 캐릭터가 소개하는 홍보 쇼츠 (인트로 캐릭터 → 제품+코너 캐릭터 → 마무리)
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4">
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
              <textarea className={inputCls} rows={3} value={sellingPoints} onChange={(e) => setSellingPoints(e.target.value)} placeholder="비타민C 20% 고농축, 3주 만에 톤업, 끈적임 없는 산뜻한 사용감" />
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
                    className={`w-16 h-22 rounded-lg overflow-hidden border-2 ${preset === p.id ? 'border-emerald-400' : 'border-neutral-700'}`}>
                    <img src={p.src} alt={p.label} className="w-full h-full object-cover" />
                  </button>
                ))}
                <label className={`w-16 h-22 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer text-xs text-neutral-400 ${charFile ? 'border-emerald-400' : 'border-neutral-700'}`}>
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
                  <option value="15">15초</option>
                  <option value="20">20초</option>
                  <option value="30">30초</option>
                </select>
              </div>
            </div>

            <button onClick={onGenerate} disabled={busy}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-neutral-950 font-semibold rounded-lg py-3">
              {busy ? '생성 중...' : '홍보 영상 생성'}
            </button>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
            <div className="text-sm font-semibold mb-3">결과</div>
            <div className="text-sm text-neutral-400 space-y-1 mb-3">
              <div>{dot(steps.script)} AI 홍보 대본</div>
              <div>{dot(steps.audio)} 나레이션 음성 (Chirp3-HD)</div>
              <div>{dot(steps.video)} 캐릭터 영상 + 합성 (Kling)</div>
            </div>
            {statusMsg && <div className="text-sm text-neutral-300 mb-3">{statusMsg}</div>}
            {error && <div className="text-sm text-red-400 mb-3">❌ {error}</div>}
            {videoUrl && <video src={videoUrl} controls autoPlay loop className="w-full max-w-[280px] rounded-xl mx-auto" />}
          </div>
        </div>
      </div>
    </div>
  );
}
