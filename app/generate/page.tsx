'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Sparkles, ArrowLeft, Download, Check, Loader2, AlertCircle, ChevronDown, Pencil, ImagePlus, X } from 'lucide-react';

type StepStatus = 'pending' | 'running' | 'done' | 'failed';

interface ScriptSection {
  type: string;
  text: string;
  duration: number;
}

interface VideoScript {
  title: string;
  hashtags: string[];
  sections: ScriptSection[];
  totalDuration: number;
  bgKeyword: string;
}

interface JobStatus {
  id: string;
  status: string;
  progress: number;
  steps: {
    script: StepStatus;
    audio: StepStatus;
    video: StepStatus;
  };
  videoUrl?: string;
  script?: VideoScript;
  error?: string;
}

interface UsageInfo {
  plan: string;
  used: number;
  limit: number | null;
  remaining: number;
}

const TONES = ['정보성', '재미있는', '감동적인', '동기부여', '교육적인'];

const VOICES = [
  { id: 'nova',    label: '지은',  desc: '여성 · 자연스러운', badge: '추천' },
  { id: 'shimmer', label: '수아',  desc: '여성 · 부드러운',   badge: '' },
  { id: 'echo',    label: '준호',  desc: '남성 · 명확한',     badge: '' },
  { id: 'onyx',    label: '민준',  desc: '남성 · 중후한',     badge: '' },
];
const SPEEDS = [
  { value: 0.9, label: '0.9×', desc: '천천히' },
  { value: 1.0, label: '1.0×', desc: '보통' },
  { value: 1.1, label: '1.1×', desc: '약간 빠르게' },
  { value: 1.2, label: '1.2×', desc: '빠르게' },
];
const DURATIONS = [
  { value: 30, label: '30초' },
  { value: 60, label: '60초' },
];

const STEP_LABELS: Record<string, string> = {
  script: 'AI 스크립트 생성',
  audio: '한국어 음성 생성',
  video: '영상 합성',
};

const SECTION_TYPE_LABELS: Record<string, string> = {
  hook:  '💡 훅',
  main:  '📌 본문',
  cta:   '🔔 CTA',
};

function StepIndicator({ label, status }: { label: string; status: StepStatus }) {
  return (
    <div className={`flex items-center gap-3 p-4 rounded-xl transition-all ${
      status === 'running' ? 'bg-purple-500/10 border border-purple-500/30' :
      status === 'done' ? 'bg-green-500/10 border border-green-500/20' :
      status === 'failed' ? 'bg-red-500/10 border border-red-500/20' :
      'bg-white/3 border border-white/5'
    }`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
        status === 'running' ? 'bg-purple-500/20' :
        status === 'done' ? 'bg-green-500/20' :
        status === 'failed' ? 'bg-red-500/20' :
        'bg-white/5'
      }`}>
        {status === 'running' && <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />}
        {status === 'done' && <Check className="w-4 h-4 text-green-400" />}
        {status === 'failed' && <AlertCircle className="w-4 h-4 text-red-400" />}
        {status === 'pending' && <div className="w-2 h-2 rounded-full bg-gray-600" />}
      </div>
      <span className={`font-medium text-sm ${
        status === 'running' ? 'text-purple-300' :
        status === 'done' ? 'text-green-300' :
        status === 'failed' ? 'text-red-300' :
        'text-gray-500'
      }`}>
        {label}
      </span>
      {status === 'running' && (
        <span className="ml-auto text-xs text-purple-400 animate-pulse">처리 중...</span>
      )}
      {status === 'done' && (
        <span className="ml-auto text-xs text-green-400">완료</span>
      )}
    </div>
  );
}

function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let id = localStorage.getItem('shortsai_session');
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('shortsai_session', id);
  }
  return id;
}

export default function GeneratePage() {
  const [topic, setTopic] = useState('');
  const [duration, setDuration] = useState(60);
  const [tone, setTone] = useState('정보성');
  const [voice, setVoice] = useState('nova');
  const [speed, setSpeed] = useState(1.1);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Script review state
  const [scriptDraft, setScriptDraft] = useState<VideoScript | null>(null);
  const [loadingScript, setLoadingScript] = useState(false);

  // Per-section images
  const [sectionImages, setSectionImages] = useState<(File | null)[]>([]);
  const [sectionPreviews, setSectionPreviews] = useState<(string | null)[]>([]);

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [showScript, setShowScript] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const sessionId = useRef<string>('');

  useEffect(() => {
    sessionId.current = getOrCreateSessionId();
    fetchUsage();
  }, []);

  // Init section images when script changes
  useEffect(() => {
    if (scriptDraft) {
      setSectionImages(scriptDraft.sections.map(() => null));
      setSectionPreviews(scriptDraft.sections.map(() => null));
    }
  }, [scriptDraft?.sections.length]);

  async function fetchUsage() {
    try {
      const res = await fetch(`/api/usage?sessionId=${sessionId.current}`);
      const data = await res.json();
      setUsage(data);
    } catch { /* ignore */ }
  }

  // Per-section image handlers
  function handleImageChange(index: number, file: File | null) {
    setSectionImages(prev => {
      const next = [...prev];
      next[index] = file;
      return next;
    });
    setSectionPreviews(prev => {
      const next = [...prev];
      if (file) {
        next[index] = URL.createObjectURL(file);
      } else {
        if (prev[index]) URL.revokeObjectURL(prev[index]!);
        next[index] = null;
      }
      return next;
    });
  }

  // Step 1: Generate script only
  async function generateScriptPreview() {
    if (!topic.trim()) return;
    setError(null);
    setLoadingScript(true);
    setScriptDraft(null);

    try {
      const res = await fetch('/api/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topic.trim(), duration, tone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '스크립트 생성에 실패했습니다.');
      setScriptDraft(data.script);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoadingScript(false);
    }
  }

  // Step 2: Upload images then generate video
  async function startGeneration() {
    setError(null);
    setLoading(true);
    setJobId(null);
    setJobStatus(null);
    setShowScript(false);

    try {
      // Upload images if any selected
      let uploadId: string | undefined;
      const hasImages = sectionImages.some(img => img !== null);
      if (hasImages) {
        const formData = new FormData();
        sectionImages.forEach((img) => {
          if (img) formData.append('images', img);
        });
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData.error || '이미지 업로드에 실패했습니다.');
        uploadId = uploadData.uploadId;
      }

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          duration,
          tone,
          voice,
          speed,
          sessionId: sessionId.current,
          prebuiltScript: scriptDraft ?? undefined,
          uploadId,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '영상 생성에 실패했습니다.');

      setJobId(data.jobId);
      startPolling(data.jobId);
      fetchUsage();
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
      setLoading(false);
    }
  }

  function startPolling(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${id}`);
        if (!res.ok) {
          if (res.status === 404) {
            clearInterval(pollRef.current!);
            setLoading(false);
            setJobId(null);
            setJobStatus(null);
            setError('생성 작업을 찾을 수 없습니다. 다시 시도해주세요.');
          }
          return;
        }
        const data: JobStatus = await res.json();
        setJobStatus(data);

        if (data.status === 'done' || data.status === 'failed') {
          clearInterval(pollRef.current!);
          setLoading(false);
        }
      } catch { /* ignore polling errors */ }
    }, 2000);
  }

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function goBackToScript() {
    setJobId(null);
    setJobStatus(null);
    setLoading(false);
    setError(null);
    // scriptDraft is still set so isScriptReview becomes true
  }

  function resetAll() {
    setJobId(null); setJobStatus(null); setLoading(false);
    setTopic(''); setError(null); setScriptDraft(null);
    setSectionImages([]); setSectionPreviews([]);
  }

  const isGenerating = loading && jobId;
  const isDone = jobStatus?.status === 'done';
  const isFailed = jobStatus?.status === 'failed';
  const isScriptReview = !loading && !jobId && scriptDraft !== null;
  const canStart = topic.trim().length > 0 && !loading && !loadingScript;

  return (
    <main className="min-h-screen bg-[#0B0A14] text-white">
      {/* Header */}
      <div className="border-b border-white/5 bg-[#0B0A14]/80 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" />
            홈으로
          </Link>
          <div className="flex items-center gap-2 font-bold">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <span className="gradient-text text-sm">ShortsAI</span>
          </div>
          {usage && (
            <div className="text-xs text-gray-500">
              {usage.limit === null ? '무제한' : `${usage.remaining}개 남음`}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">
            쇼츠 영상 <span className="gradient-text">자동 생성</span>
          </h1>
          <p className="text-gray-400">주제를 입력하면 AI가 완성된 영상을 만들어드립니다</p>
        </div>

        {/* Usage warning */}
        {usage && usage.remaining === 0 && (
          <div className="mb-6 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-yellow-300 font-medium text-sm">이번 달 한도 초과</p>
              <p className="text-yellow-400/70 text-xs mt-0.5">
                더 만들려면 <Link href="/#pricing" className="underline">플랜을 업그레이드</Link>해주세요
              </p>
            </div>
          </div>
        )}

        {/* ── PHASE 1: Form ── */}
        {!isGenerating && !isDone && !isScriptReview && (
          <div className="glass-card p-6 space-y-5">
            {/* Topic input */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                주제 <span className="text-red-400">*</span>
              </label>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="예: 다이어트 팁 5가지, 재테크 기초, 영어 공부 방법..."
                rows={3}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 focus:bg-white/8 transition-all resize-none text-sm"
                onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) generateScriptPreview(); }}
              />
              <p className="text-gray-600 text-xs mt-1">구체적인 주제일수록 좋은 영상이 나옵니다</p>
            </div>

            {/* Duration */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">영상 길이</label>
              <div className="flex gap-3">
                {DURATIONS.map((d) => (
                  <button
                    key={d.value}
                    onClick={() => setDuration(d.value)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                      duration === d.value
                        ? 'bg-purple-500/20 border-purple-500/50 text-purple-300'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:border-white/20'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tone */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">톤 / 스타일</label>
              <div className="flex flex-wrap gap-2">
                {TONES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTone(t)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-all border ${
                      tone === t
                        ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Advanced settings */}
            <div className="border-t border-white/5 pt-4">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                고급 설정
                <span className="text-xs text-gray-600 ml-1">
                  {VOICES.find(v => v.id === voice)?.label} · {speed}×
                </span>
              </button>

              {showAdvanced && (
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      🎙 나레이터 음성
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {VOICES.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setVoice(v.id)}
                          className={`relative p-3 rounded-xl text-left transition-all border ${
                            voice === v.id
                              ? 'bg-purple-500/20 border-purple-500/50'
                              : 'bg-white/3 border-white/8 hover:border-white/20'
                          }`}
                        >
                          {v.badge && (
                            <span className="absolute top-1.5 right-1.5 text-[10px] bg-purple-500/40 text-purple-300 px-1.5 py-0.5 rounded-full">
                              {v.badge}
                            </span>
                          )}
                          <p className={`font-semibold text-sm ${voice === v.id ? 'text-purple-200' : 'text-gray-200'}`}>
                            {v.label}
                          </p>
                          <p className="text-[11px] text-gray-500 mt-0.5">{v.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      ⚡ 음성 속도
                    </label>
                    <div className="flex gap-2">
                      {SPEEDS.map((s) => (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => setSpeed(s.value)}
                          className={`flex-1 py-2.5 rounded-xl text-center transition-all border ${
                            speed === s.value
                              ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                              : 'bg-white/3 border-white/8 text-gray-400 hover:text-white hover:border-white/20'
                          }`}
                        >
                          <p className="font-semibold text-sm">{s.label}</p>
                          <p className="text-[10px] text-gray-500 mt-0.5">{s.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              onClick={generateScriptPreview}
              disabled={!canStart || (usage?.remaining === 0)}
              className="w-full py-4 rounded-xl bg-gradient-brand text-white font-bold text-base disabled:opacity-40 hover:opacity-90 transition-all flex items-center justify-center gap-2"
            >
              {loadingScript ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  스크립트 생성 중...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  AI 스크립트 생성
                </>
              )}
            </button>
          </div>
        )}

        {/* ── PHASE 2: Script Review ── */}
        {isScriptReview && scriptDraft && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-lg flex items-center gap-2">
                  <Pencil className="w-5 h-5 text-purple-400" />
                  스크립트 확인 · 수정
                </h2>
                <p className="text-gray-500 text-xs mt-0.5">텍스트와 사진을 수정한 뒤 영상 생성을 시작하세요</p>
              </div>
              <button
                onClick={() => setScriptDraft(null)}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                ← 처음으로
              </button>
            </div>

            <div className="glass-card p-5 space-y-4">
              {/* Title */}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">제목</label>
                <input
                  type="text"
                  value={scriptDraft.title}
                  onChange={(e) => setScriptDraft({ ...scriptDraft, title: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500/50 transition-all"
                />
              </div>

              {/* Sections */}
              {scriptDraft.sections.map((section, i) => (
                <div key={i} className="bg-white/3 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                      {SECTION_TYPE_LABELS[section.type] ?? section.type}
                    </span>
                    <span className="text-xs text-gray-600">{section.duration}초</span>
                  </div>

                  {/* Script text */}
                  <textarea
                    value={section.text}
                    onChange={(e) => {
                      const sections = [...scriptDraft.sections];
                      sections[i] = { ...sections[i], text: e.target.value };
                      setScriptDraft({ ...scriptDraft, sections });
                    }}
                    rows={3}
                    className="w-full bg-transparent border border-white/10 rounded-lg px-3 py-2 text-gray-200 text-sm focus:outline-none focus:border-purple-500/40 transition-all resize-none"
                  />

                  {/* Image upload for this section */}
                  <div>
                    {sectionPreviews[i] ? (
                      <div className="relative group w-full h-28 rounded-lg overflow-hidden border border-white/10">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={sectionPreviews[i]!}
                          alt="섹션 이미지"
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => handleImageChange(i, null)}
                          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3.5 h-3.5 text-white" />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-white/20 text-gray-500 hover:border-purple-500/40 hover:text-purple-400 transition-colors cursor-pointer text-xs">
                        <ImagePlus className="w-4 h-4 flex-shrink-0" />
                        <span>이 섹션에 사진 추가 (선택)</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0] ?? null;
                            handleImageChange(i, file);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )}
                  </div>
                </div>
              ))}

              {/* Hashtags */}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">해시태그</label>
                <div className="flex flex-wrap gap-2">
                  {scriptDraft.hashtags.map((tag) => (
                    <span key={tag} className="px-2 py-1 rounded-lg bg-purple-500/10 text-purple-300 text-xs">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={generateScriptPreview}
                disabled={loadingScript}
                className="flex-1 py-3 rounded-xl bg-white/10 text-white font-medium hover:bg-white/15 transition-all border border-white/10 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loadingScript ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                스크립트 재생성
              </button>
              <button
                onClick={startGeneration}
                disabled={usage?.remaining === 0}
                className="flex-2 flex-grow py-3 rounded-xl bg-gradient-brand text-white font-bold text-sm hover:opacity-90 transition-all disabled:opacity-40 flex items-center justify-center gap-2 px-6"
              >
                <Check className="w-4 h-4" />
                이 스크립트로 영상 생성
              </button>
            </div>
          </div>
        )}

        {/* Generation progress */}
        {isGenerating && jobStatus && (
          <div className="glass-card p-6 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-bold text-lg">영상 생성 중...</h2>
              <span className="text-purple-400 font-bold">{jobStatus.progress ?? 0}%</span>
            </div>

            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full progress-bar rounded-full transition-all duration-500"
                style={{ width: `${jobStatus.progress}%` }}
              />
            </div>

            <div className="space-y-2 mt-4">
              {(Object.entries(jobStatus.steps ?? {}) as Array<[string, StepStatus]>).map(([key, status]) => (
                <StepIndicator key={key} label={STEP_LABELS[key]} status={status} />
              ))}
            </div>

            <p className="text-center text-gray-500 text-xs mt-4">
              보통 1-2분 소요됩니다. 잠시만 기다려주세요 ☕
            </p>
          </div>
        )}

        {/* Loading before first status */}
        {loading && !jobStatus && (
          <div className="glass-card p-8 text-center">
            <Loader2 className="w-8 h-8 text-purple-400 animate-spin mx-auto mb-4" />
            <p className="text-gray-300">영상 생성을 시작하는 중...</p>
          </div>
        )}

        {/* Error state */}
        {isFailed && (
          <div className="glass-card p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <AlertCircle className="w-6 h-6" />
              <h2 className="font-bold text-lg">생성 실패</h2>
            </div>
            <p className="text-gray-400 text-sm">{jobStatus?.error || '알 수 없는 오류가 발생했습니다.'}</p>
            <button
              onClick={() => { setJobId(null); setJobStatus(null); setLoading(false); setError(null); }}
              className="w-full py-3 rounded-xl bg-white/10 text-white font-medium hover:bg-white/15 transition-all"
            >
              다시 시도
            </button>
          </div>
        )}

        {/* Done state */}
        {isDone && jobStatus && (
          <div className="space-y-4">
            <div className="glass-card p-4 flex items-center gap-3 border-green-500/20 bg-green-500/5">
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <Check className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <p className="font-bold text-green-300">영상 생성 완료!</p>
                <p className="text-gray-400 text-xs">{jobStatus.script?.title}</p>
              </div>
            </div>

            {jobStatus.videoUrl && (
              <div className="glass-card overflow-hidden">
                <video
                  controls
                  className="w-full max-h-96 object-contain bg-black"
                  src={jobStatus.videoUrl}
                >
                  영상을 재생할 수 없습니다.
                </video>
              </div>
            )}

            <div className="flex gap-3">
              {jobStatus.videoUrl && (
                <a
                  href={jobStatus.videoUrl}
                  download={`shorts_${Date.now()}.mp4`}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-brand text-white font-bold hover:opacity-90 transition-all"
                >
                  <Download className="w-4 h-4" />
                  MP4 다운로드
                </a>
              )}
              <button
                onClick={goBackToScript}
                className="flex-1 py-3 rounded-xl bg-purple-500/15 text-purple-300 font-medium hover:bg-purple-500/25 transition-all border border-purple-500/30 flex items-center justify-center gap-2"
              >
                <Pencil className="w-4 h-4" />
                스크립트 수정
              </button>
              <button
                onClick={resetAll}
                className="flex-1 py-3 rounded-xl bg-white/10 text-white font-medium hover:bg-white/15 transition-all border border-white/10"
              >
                새 영상 만들기
              </button>
            </div>

            {/* Script preview */}
            {jobStatus.script && (
              <div className="glass-card">
                <button
                  onClick={() => setShowScript(!showScript)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-white/3 transition-colors rounded-2xl"
                >
                  <span className="font-medium text-sm">스크립트 보기</span>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showScript ? 'rotate-180' : ''}`} />
                </button>

                {showScript && (
                  <div className="px-4 pb-4 space-y-3">
                    <div className="flex flex-wrap gap-2 mb-3">
                      {jobStatus.script.hashtags.map((tag) => (
                        <span key={tag} className="px-2 py-1 rounded-lg bg-purple-500/10 text-purple-300 text-xs">
                          {tag}
                        </span>
                      ))}
                    </div>
                    {jobStatus.script.sections.map((section, i) => (
                      <div key={i} className="bg-white/3 rounded-xl p-3">
                        <div className="text-xs text-gray-500 mb-1 uppercase tracking-wide">
                          {SECTION_TYPE_LABELS[section.type] ?? `📌 섹션 ${i + 1}`}
                          <span className="ml-2">{section.duration}초</span>
                        </div>
                        <p className="text-gray-300 text-sm">{section.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
