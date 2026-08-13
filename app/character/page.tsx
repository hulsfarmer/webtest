'use client';

import { useState, useRef } from 'react';

const VOICES = [
  { id: 'ko-KR-Chirp3-HD-Aoede', label: '지은 (여·자연스러운)' },
  { id: 'ko-KR-Chirp3-HD-Zephyr', label: '수아 (여·활기찬)' },
  { id: 'ko-KR-Chirp3-HD-Charon', label: '민준 (남·자연스러운)' },
];

const PRESETS = [
  { id: 'preset-jieun', label: '지은', src: '/characters/preset-jieun.png' },
];

type StepState = 'pending' | 'running' | 'done' | 'failed';

export default function CharacterPage() {
  const [preset, setPreset] = useState<string>('preset-jieun');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string>('');
  const [script, setScript] = useState('안녕하세요! 저는 여러분의 새로운 AI 캐릭터입니다. 오늘은 특별한 제품을 소개해 드릴게요.');
  const [voice, setVoice] = useState(VOICES[0].id);
  const [speed, setSpeed] = useState('1.0');
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [steps, setSteps] = useState<{ audio: StepState; video: StepState }>({ audio: 'pending', video: 'pending' });
  const [videoUrl, setVideoUrl] = useState('');
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setUploadFile(f);
    setUploadPreview(f ? URL.createObjectURL(f) : '');
    if (f) setPreset('');
  }

  async function onGenerate() {
    setError('');
    setVideoUrl('');
    if (!uploadFile && !preset) { setError('캐릭터 이미지를 올리거나 프리셋을 선택하세요.'); return; }
    if (!script.trim()) { setError('스크립트를 입력하세요.'); return; }

    const fd = new FormData();
    if (uploadFile) fd.append('image', uploadFile);
    else fd.append('preset', preset);
    fd.append('script', script);
    fd.append('voice', voice);
    fd.append('speed', speed);

    setBusy(true);
    setStatusMsg('⏳ 음성 생성 & 업로드 중...');
    setSteps({ audio: 'running', video: 'pending' });

    try {
      const r = await fetch('/api/character', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '생성 실패');
      poll(data.jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setSteps({ audio: 'failed', video: 'pending' });
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
        setSteps({
          audio: d.steps?.audio ?? 'running',
          video: d.steps?.video ?? 'pending',
        });
        if (d.status === 'done' && d.videoUrl) {
          if (pollRef.current) clearInterval(pollRef.current);
          setVideoUrl(d.videoUrl);
          setStatusMsg(`✅ 완료! (${secs}초)`);
          setBusy(false);
        } else if (d.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          setError(d.error || '생성 실패');
          setStatusMsg('');
          setBusy(false);
        } else {
          setStatusMsg(`⏳ 처리 중... (${secs}초 경과 · Kling Avatar 생성은 보통 1~2분)`);
        }
      } catch { /* keep polling */ }
    }, 3000);
  }

  const stepDot = (s: StepState) => s === 'done' ? '✅' : s === 'running' ? '⏳' : s === 'failed' ? '❌' : '⚪';

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-4 py-10">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold">🎬 말하는 캐릭터</h1>
        <p className="text-sm text-neutral-400 mt-1 mb-8">
          캐릭터 이미지 + 스크립트 → 자연스럽게 말하는 9:16 쇼츠 영상 (Kling Avatar · Chirp3-HD 음성)
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          {/* 입력 */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-5">
            <div>
              <label className="block text-sm text-neutral-300 mb-2">1. 캐릭터 선택</label>
              <div className="flex gap-3 flex-wrap">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setPreset(p.id); setUploadFile(null); setUploadPreview(''); }}
                    className={`relative w-20 h-28 rounded-lg overflow-hidden border-2 ${preset === p.id ? 'border-emerald-400' : 'border-neutral-700'}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.src} alt={p.label} className="w-full h-full object-cover" />
                  </button>
                ))}
                <label className={`w-20 h-28 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer text-xs text-neutral-400 ${uploadFile ? 'border-emerald-400' : 'border-neutral-700'}`}>
                  {uploadPreview
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={uploadPreview} alt="upload" className="w-full h-full object-cover rounded-md" />
                    : <span>+ 업로드</span>}
                  <input type="file" accept="image/*" className="hidden" onChange={onPickFile} />
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm text-neutral-300 mb-2">2. 스크립트 (나레이션)</label>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                rows={4}
                className="w-full bg-neutral-950 border border-neutral-700 rounded-lg p-3 text-sm resize-y"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-neutral-300 mb-2">목소리</label>
                <select value={voice} onChange={(e) => setVoice(e.target.value)} className="w-full bg-neutral-950 border border-neutral-700 rounded-lg p-2.5 text-sm">
                  {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-neutral-300 mb-2">속도</label>
                <select value={speed} onChange={(e) => setSpeed(e.target.value)} className="w-full bg-neutral-950 border border-neutral-700 rounded-lg p-2.5 text-sm">
                  <option value="0.9">0.9×</option>
                  <option value="1.0">1.0×</option>
                  <option value="1.1">1.1×</option>
                </select>
              </div>
            </div>

            <button
              onClick={onGenerate}
              disabled={busy}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-neutral-950 font-semibold rounded-lg py-3"
            >
              {busy ? '생성 중...' : '영상 생성'}
            </button>
          </div>

          {/* 결과 */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
            <div className="text-sm font-semibold mb-3">결과</div>
            <div className="text-sm text-neutral-400 space-y-1 mb-3">
              <div>{stepDot(steps.audio)} 음성 생성 (Chirp3-HD)</div>
              <div>{stepDot(steps.video)} 영상 생성 (Kling Avatar)</div>
            </div>
            {statusMsg && <div className="text-sm text-neutral-300 mb-3">{statusMsg}</div>}
            {error && <div className="text-sm text-red-400 mb-3">❌ {error}</div>}
            {videoUrl && (
              <video src={videoUrl} controls autoPlay loop className="w-full max-w-[280px] rounded-xl mx-auto" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
