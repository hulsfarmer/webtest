'use client';

import { useState, useRef, useEffect } from 'react';

// 목소리 = google 보이스 + 피치(반음). Azure 엔진이면 engine/azure* 로 네이티브 톤.
type VoiceCfg = { id: string; label: string; google: string; pitch: number; engine?: string; azureVoice?: string; azurePitch?: string; azureRate?: string };
const VOICES: VoiceCfg[] = [
  { id: 'minji',  label: '민지 (여·자연)',    google: 'ko-KR-Chirp3-HD-Aoede',  pitch: 0 },
  { id: 'sua',    label: '수아 (여·활기)',    google: 'ko-KR-Chirp3-HD-Zephyr', pitch: 0 },
  { id: 'minjun', label: '민준 (남·자연)',    google: 'ko-KR-Chirp3-HD-Charon', pitch: 0 },
  { id: 'teen',   label: '민서 (청소년·남)',  google: 'ko-KR-Chirp3-HD-Charon', pitch: 2 },
  { id: 'child',  label: '하늘 (아이 톤)',    google: 'ko-KR-Chirp3-HD-Aoede',  pitch: 3 },
  { id: 'dog',    label: '코코 (강아지 톤)',  google: 'ko-KR-Chirp3-HD-Zephyr', pitch: 4 },
  // 뭉치 = Azure 네이티브(귀여운 아이 톤). 실패 시 Google Zephyr+5 폴백.
  { id: 'puppy',  label: '뭉치 (귀여운 강아지)', google: 'ko-KR-Chirp3-HD-Zephyr', pitch: 5,
    engine: 'azure', azureVoice: 'ko-KR-YuJinNeural', azurePitch: '+45%', azureRate: '+8%' },
];
const PRESETS = [
  { id: 'preset-jieun', label: '민지·여성',   name: '민지', src: '/characters/preset-jieun.png', voiceKey: 'minji' },
  { id: 'preset-male',  label: '준호·남성',   name: '준호', src: '/characters/preset-male.png',  voiceKey: 'minjun' },
  { id: 'preset-teen',  label: '민서·청소년', name: '민서', src: '/characters/preset-teen.png',  voiceKey: 'teen' },
  { id: 'preset-child', label: '하늘·아이',   name: '하늘', src: '/characters/preset-child.png', voiceKey: 'child' },
  { id: 'preset-dog',   label: '코코·강아지', name: '코코', src: '/characters/preset-dog.png',   voiceKey: 'dog' },
  { id: 'preset-puppy', label: '뭉치·카툰강아지', name: '뭉치', src: '/characters/preset-puppy.png', voiceKey: 'puppy' },
];
const HEADER_THEMES = [
  { id: 'navy', label: '테크 네이비', desc: 'IT·재테크', bg: '#0A192F', bn: '#00E5FF', title: '#FFFFFF' },
  { id: 'black', label: '클래식 블랙', desc: '정보·뉴스', bg: '#121212', bn: '#FFE600', title: '#FFFFFF' },
  { id: 'neon', label: '네온 옐로우', desc: '핫이슈·썰', bg: '#E5FF00', bn: '#14213D', title: '#D32F2F' },
  { id: 'violet', label: '트렌디 바이올렛', desc: '엔터·뷰티', bg: '#1A0B2E', bn: '#FF2A85', title: '#FFFFFF' },
  { id: 'burgundy', label: '버건디 골드', desc: '리뷰·경고', bg: '#4A0E17', bn: '#FFC107', title: '#FFFFFF' },
];
type StepState = 'pending' | 'running' | 'done' | 'failed';
type Section = { type: 'hook' | 'main' | 'cta'; label: string; text: string };

export default function PromoCharacterPage() {
  const [phase, setPhase] = useState<'form' | 'script'>('form');
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [sellingPoints, setSellingPoints] = useState('');
  const [cta, setCta] = useState('');
  const [catchphrase, setCatchphrase] = useState('');
  const [headerTheme, setHeaderTheme] = useState('navy');
  const [headerPreview, setHeaderPreview] = useState('');
  const [voiceKey, setVoiceKey] = useState('minji');
  const [duration, setDuration] = useState('20');
  const [speed, setSpeed] = useState('1.1');
  const [preset, setPreset] = useState('preset-jieun');
  const [charFile, setCharFile] = useState<File | null>(null);
  const [charPreview, setCharPreview] = useState('');
  const [productFile, setProductFile] = useState<File | null>(null);
  const [productPreview, setProductPreview] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [buyLink, setBuyLink] = useState(''); // 쿠팡 구매 링크 (유튜브 설명란)
  const [importBusy, setImportBusy] = useState(false);
  const [importedImagePath, setImportedImagePath] = useState(''); // /imports/xxx
  const [importNote, setImportNote] = useState('');

  const [sections, setSections] = useState<Section[]>([]);
  const [scriptBusy, setScriptBusy] = useState(false);

  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [steps, setSteps] = useState<{ script: StepState; audio: StepState; video: StepState }>({ script: 'pending', audio: 'pending', video: 'pending' });
  const [videoUrl, setVideoUrl] = useState('');
  const [jobId, setJobId] = useState('');
  const [error, setError] = useState('');
  // 자동 발행 (YouTube)
  const [ytConnected, setYtConnected] = useState(false);
  const [ytBusy, setYtBusy] = useState(false);
  const [ytMsg, setYtMsg] = useState('');
  const [ytUrl, setYtUrl] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputCls = 'w-full bg-neutral-950 border border-neutral-700 rounded-lg p-2.5 text-sm';

  // 헤더 실시간 미리보기 (테마·문구 바뀔 때 디바운스 후 렌더)
  useEffect(() => {
    if (phase !== 'script' || !businessName.trim()) { setHeaderPreview(''); return; }
    const id = setTimeout(async () => {
      try {
        const r = await fetch('/api/promo-character/header-preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ businessName, catchphrase, headerTheme }),
        });
        const d = await r.json();
        if (r.ok && d.image) setHeaderPreview(d.image);
      } catch { /* noop */ }
    }, 400);
    return () => clearTimeout(id);
  }, [phase, businessName, catchphrase, headerTheme]);

  // YouTube 연결 상태 확인 + 콜백(?yt=) 처리
  useEffect(() => {
    fetch('/api/social/youtube/status').then((r) => r.json()).then((d) => setYtConnected(!!d.connected)).catch(() => {});
    const q = new URLSearchParams(window.location.search).get('yt');
    if (q === 'connected') { setYtMsg('YouTube 연결 완료'); setYtConnected(true); }
    else if (q === 'error') setYtMsg('YouTube 연결 실패 — 다시 시도하세요.');
    if (q) window.history.replaceState({}, '', '/promo-character');
  }, []);

  // 유튜브 설명란: 나레이션 원문 + 구매 링크 + 제작 크레딧
  function buildDescription(): string {
    const narration = sections.map((s) => s.text).join('  ')
      .replace(/[*#`_~]/g, '').replace(/[ \t]+/g, ' ').trim();
    const link = (buyLink || importUrl).trim();
    const lines: string[] = [];
    if (narration) lines.push(narration);
    if (link) {
      lines.push('', `🛒 구매하기 👉 ${link}`);
      lines.push('', '이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.');
    }
    lines.push('', '🎬 제작: 이지온', '📩 AI영상제작문의: huls_family@naver.com (이지온)');
    return lines.join('\n');
  }

  async function publishYouTube() {
    if (!jobId) return;
    setYtBusy(true); setYtMsg(''); setYtUrl('');
    try {
      const title = `${businessName} ${catchphrase}`.trim().slice(0, 90) || '제품 홍보';
      const desc = buildDescription();
      const r = await fetch('/api/social/youtube/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, title, description: desc, privacyStatus: 'private' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '업로드 실패');
      setYtUrl(d.url); setYtMsg('YouTube 업로드 완료 (비공개) — 검토 후 공개로 바꾸세요.');
    } catch (e) {
      setYtMsg(e instanceof Error ? e.message : String(e));
    } finally { setYtBusy(false); }
  }

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
      if (!buyLink.trim()) setBuyLink(importUrl.trim()); // 구매 링크 자동 채움
      if (d.title) setBusinessName(d.title);
      if (d.businessType) setBusinessType(d.businessType);
      if (d.description) setSellingPoints(d.description);
      if (d.imageUrl) setProductPreview(d.imageUrl);            // 미리보기 data URI
      if (d.imagePath) { setImportedImagePath(d.imagePath); setProductFile(null); } // 영상 생성용 경로
      const got = [d.title && '제품명', d.imageUrl && '이미지', d.description && '홍보포인트'].filter(Boolean).join('·');
      const tail = d.descriptionSource === 'images'
        ? '상세페이지 이미지를 읽어 홍보 포인트를 자동 추출했어요 — 사실과 맞는지 확인·수정하세요.'
        : !d.description
          ? '홍보 포인트를 못 찾았어요 — 아래에 제품 핵심 특징을 직접 적어주세요 (대본 품질을 좌우해요).'
          : '내용을 확인·수정한 뒤 진행하세요.';
      setImportNote((got ? `${got} 불러왔어요. ` : '') + tail);
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
      const characterName = charFile ? '' : (PRESETS.find((p) => p.id === preset)?.name ?? '');
      const r = await fetch('/api/promo-character/script', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessName, businessType, sellingPoints, cta, duration, tone: '친근한', characterName }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '대본 생성 실패');
      setSections(d.sections);
      if (d.title && !catchphrase.trim()) setCatchphrase(d.title); // 홍보문구 기본값 = AI 캐치 타이틀
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
    const v = VOICES.find((x) => x.id === voiceKey) ?? VOICES[0];
    fd.append('voice', v.google);
    fd.append('ttsEngine', v.engine ?? 'google');
    fd.append('azureVoice', v.azureVoice ?? '');
    fd.append('azurePitch', v.azurePitch ?? '0%');
    fd.append('azureRate', v.azureRate ?? '0%');
    fd.append('duration', duration);
    fd.append('speed', speed);
    fd.append('pitch', charFile ? '0' : String(v.pitch)); // 업로드 캐릭터는 피치 0
    if (productFile) fd.append('product', productFile); else fd.append('productPath', importedImagePath);
    if (charFile) fd.append('character', charFile); else fd.append('preset', preset);
    fd.append('characterName', charFile ? '' : (PRESETS.find((p) => p.id === preset)?.name ?? ''));
    fd.append('sections', JSON.stringify(sections.map((s) => ({ type: s.type, text: s.text }))));
    fd.append('catchphrase', catchphrase);
    fd.append('headerTheme', headerTheme);

    setBusy(true); setSteps({ script: 'done', audio: 'running', video: 'pending' });
    setStatusMsg('나레이션 음성 생성 중...');
    try {
      const r = await fetch('/api/promo-character', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '생성 실패');
      setJobId(data.jobId); setYtMsg(''); setYtUrl('');
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
          setVideoUrl(d.videoUrl); setStatusMsg(`완료! (${secs}초)`); setBusy(false);
        } else if (d.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          setError(d.error || '생성 실패'); setStatusMsg(''); setBusy(false);
        } else {
          setStatusMsg(`처리 중... (${secs}초 경과 · 캐릭터 영상 생성은 길이에 따라 5~15분 걸립니다)`);
        }
      } catch { /* keep polling */ }
    }, 3000);
  }

  const dot = (s: StepState) => s === 'done' ? '완료' : s === 'running' ? '진행' : s === 'failed' ? '실패' : '대기';

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-4 py-10">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold">제품 홍보 캐릭터 영상</h1>
        <p className="text-sm text-neutral-400 mt-1 mb-8">
          제품 정보 → AI 대본(검토·편집) → 캐릭터 홍보 쇼츠 (인트로 → 제품+코너 캐릭터 → 마무리, 상단 제품명 고정)
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          {/* 좌: 입력 or 대본편집 */}
          {phase === 'form' ? (
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4">
              <div className="pb-4 border-b border-neutral-800">
                <label className="block text-sm text-emerald-300 mb-1.5">제품 링크로 자동 채우기 (선택)</label>
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
                <label className="block text-sm text-neutral-300 mb-1.5">구매 링크 (쿠팡 등 · 유튜브 설명란에 삽입)</label>
                <input className={inputCls} value={buyLink} onChange={(e) => setBuyLink(e.target.value)} placeholder="https://link.coupang.com/..." />
                <p className="text-xs text-neutral-500 mt-1.5">제품 링크를 불러오면 자동으로 채워져요. 쿠팡 파트너스 링크로 바꿔 넣으면 수익이 발생합니다.</p>
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
                    <button key={p.id} title={p.label}
                      onClick={() => { setPreset(p.id); setVoiceKey(p.voiceKey); setCharFile(null); setCharPreview(''); }}
                      className={`w-16 h-20 rounded-lg overflow-hidden border-2 ${preset === p.id && !charFile ? 'border-emerald-400' : 'border-neutral-700'}`}>
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
                  <select className={inputCls} value={voiceKey} onChange={(e) => setVoiceKey(e.target.value)}>
                    {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-neutral-300 mb-1.5">길이(초)</label>
                  <select className={inputCls} value={duration} onChange={(e) => setDuration(e.target.value)}>
                    <option value="20">20초</option>
                    <option value="30">30초</option>
                    <option value="45">45초</option>
                    <option value="60">60초</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm text-neutral-300 mb-1.5">영상 속도</label>
                <select className={inputCls} value={speed} onChange={(e) => setSpeed(e.target.value)}>
                  <option value="1.0">1.0배 (원속도)</option>
                  <option value="1.1">1.1배 (권장)</option>
                  <option value="1.2">1.2배</option>
                </select>
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
              <p className="text-xs text-neutral-500">각 장면에 들어갈 나레이션이에요. 자유롭게 수정하세요.</p>
              {sections.map((s, i) => (
                <div key={s.type}>
                  <label className="block text-sm text-emerald-300 mb-1.5">{s.label}</label>
                  <textarea className={inputCls} rows={2} value={s.text}
                    onChange={(e) => setSections((prev) => prev.map((p, j) => j === i ? { ...p, text: e.target.value } : p))} />
                </div>
              ))}

              {/* 헤더 설정 */}
              <div className="pt-3 border-t border-neutral-800 space-y-3">
                <div className="text-sm font-semibold">상단 헤더</div>
                <div className="text-xs text-neutral-500">윗줄=제품명 &quot;{businessName}&quot;, 아랫줄=홍보문구</div>
                <div>
                  <label className="block text-sm text-neutral-300 mb-1.5">홍보 문구 (헤더 아랫줄)</label>
                  <input className={inputCls} value={catchphrase} onChange={(e) => setCatchphrase(e.target.value)} placeholder="예: 3주 만에 톤업 완성" />
                </div>
                <div>
                  <label className="block text-sm text-neutral-300 mb-1.5">헤더 테마</label>
                  <div className="grid grid-cols-3 gap-2">
                    {HEADER_THEMES.map((t) => (
                      <button key={t.id} type="button" onClick={() => setHeaderTheme(t.id)}
                        className={`relative p-2 rounded-xl border transition-all ${headerTheme === t.id ? 'border-emerald-500/60 ring-1 ring-emerald-500/40' : 'border-white/10 hover:border-white/25'}`}>
                        <div className="h-10 rounded-lg flex items-center justify-center mb-1.5" style={{ background: t.bg }}>
                          <span style={{ color: t.bn }} className="text-sm font-extrabold">가</span>
                          <span style={{ color: t.title }} className="text-sm font-extrabold ml-0.5">나</span>
                        </div>
                        <p className={`text-[11px] font-semibold leading-tight ${headerTheme === t.id ? 'text-emerald-200' : 'text-neutral-300'}`}>{t.label}</p>
                        <p className="text-[9px] text-neutral-500 leading-tight">{t.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
                {headerPreview && (
                  <div>
                    <div className="text-xs text-neutral-500 mb-1">헤더 미리보기</div>
                    <div className="w-[150px] rounded-lg overflow-hidden border border-neutral-700" style={{ aspectRatio: '9/16', background: 'linear-gradient(#6b7280,#374151)' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={headerPreview} alt="header preview" className="w-full block" />
                    </div>
                  </div>
                )}
              </div>

              <button onClick={onGenerateVideo} disabled={busy}
                className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-neutral-950 font-semibold rounded-lg py-3">
                {busy ? '영상 생성 중...' : '② 이 대본으로 영상 생성'}
              </button>
            </div>
          )}

          {/* 우: 결과 */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold">결과</div>
              <span className={`text-[11px] rounded-full px-2 py-0.5 ${ytConnected ? 'bg-green-900/60 text-green-300' : 'bg-neutral-800 text-neutral-400'}`}>
                YouTube {ytConnected ? '연결됨' : '미연결'}
              </span>
            </div>
            {ytMsg && !videoUrl && <div className="text-xs text-neutral-300 mb-3">{ytMsg}</div>}
            <div className="text-sm text-neutral-400 space-y-1 mb-3">
              <div>{dot(steps.script)} 대본</div>
              <div>{dot(steps.audio)} 나레이션 음성 (Chirp3-HD)</div>
              <div>{dot(steps.video)} 캐릭터 영상 + 합성 (Kling)</div>
            </div>
            {statusMsg && <div className="text-sm text-neutral-300 mb-3">{statusMsg}</div>}
            {error && <div className="text-sm text-red-400 mb-3">{error}</div>}
            {videoUrl && <video src={videoUrl} controls autoPlay loop className="w-full max-w-[280px] rounded-xl mx-auto" />}
            {!videoUrl && !error && phase === 'form' && <div className="text-xs text-neutral-500">먼저 제품 정보를 넣고 &quot;AI 대본 생성&quot;을 누르세요.</div>}

            {/* 완성 후 자동 발행 */}
            {videoUrl && (
              <div className="mt-4 pt-4 border-t border-neutral-800">
                <div className="text-sm font-semibold mb-2">자동 발행 (내 채널)</div>
                {!ytConnected ? (
                  <a href="/api/social/youtube/connect" className="inline-block text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg px-3 py-2">
                    ▶ YouTube 연결하기
                  </a>
                ) : (
                  <button onClick={publishYouTube} disabled={ytBusy}
                    className="text-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg px-3 py-2">
                    {ytBusy ? '업로드 중...' : '▶ YouTube에 올리기 (비공개)'}
                  </button>
                )}
                {ytMsg && <div className="text-xs text-neutral-300 mt-2">{ytMsg}</div>}
                {ytUrl && <a href={ytUrl} target="_blank" rel="noreferrer" className="text-xs text-sky-400 underline mt-1 block">{ytUrl}</a>}
                <div className="text-[11px] text-neutral-500 mt-2">업로드는 비공개로 올라갑니다. 검토 후 YouTube 스튜디오에서 공개로 바꾸세요.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
