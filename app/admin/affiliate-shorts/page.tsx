'use client';

// 관리자 전용 — 후킹형 제휴 쇼츠 생성기 UI.
// 폼 → POST /api/affiliate-shorts → jobId 폴링 → 진행바 → 미리보기 + 설명란 + 다운로드.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';

interface JobState {
  status: string;
  progress: number;
  steps?: { script: string; audio: string; video: string };
  videoUrl?: string;
  script?: string;
  error?: string;
}

interface HookScriptShape {
  captions: string[];
  cta: { brand: string; action: string };
  title: string;
  description: string;
  hashtags: string[];
}

const ANGLES = ['트렌드', '가성비', '공포', '지목'] as const;
const MUSIC_TONES = [
  { v: 'energetic', label: '에너지틱/드라이빙' },
  { v: 'calm', label: '차분/프리미엄' },
  { v: 'cinematic', label: '시네마틱/웅장' },
];

export default function AffiliateShortsAdminPage() {
  const { data: session, status: authStatus } = useSession();
  const isAdmin = (session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;

  const [productName, setProductName] = useState('');
  const [sellingPoints, setSellingPoints] = useState('');
  const [target, setTarget] = useState('');
  const [tone, setTone] = useState('');
  const [angle, setAngle] = useState<(typeof ANGLES)[number]>('트렌드');
  const [brand, setBrand] = useState('');
  const [affiliateUrl, setAffiliateUrl] = useState('');
  const [resolution, setResolution] = useState<'480p' | '720p'>('480p');
  const [musicTone, setMusicTone] = useState('energetic');
  const [productFile, setProductFile] = useState<File | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [estCost, setEstCost] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback((id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/affiliate-shorts?jobId=${id}`);
        const j = (await r.json()) as JobState;
        setJob(j);
        if (j.status === 'done' || j.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
  }, []);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const submit = async () => {
    setErr('');
    if (!productName.trim()) return setErr('제품명을 입력하세요.');
    if (!sellingPoints.trim()) return setErr('셀링포인트를 입력하세요.');
    if (!productFile) return setErr('제품 사진을 업로드하세요.');
    setSubmitting(true);
    setJob(null);
    try {
      const fd = new FormData();
      fd.set('productName', productName);
      fd.set('sellingPoints', sellingPoints);
      fd.set('target', target);
      fd.set('tone', tone);
      fd.set('angle', angle);
      fd.set('brand', brand);
      fd.set('affiliateUrl', affiliateUrl);
      fd.set('resolution', resolution);
      fd.set('musicTone', musicTone);
      fd.set('product', productFile);
      const r = await fetch('/api/affiliate-shorts', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '생성 요청 실패');
      setJobId(j.jobId);
      setEstCost(j.estimatedCostUsd ?? null);
      poll(j.jobId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '오류');
    } finally {
      setSubmitting(false);
    }
  };

  if (authStatus === 'loading') return <div className="p-8">로딩 중…</div>;
  if (!isAdmin)
    return <div className="p-8 text-red-600">관리자 전용 페이지입니다.</div>;

  const parsedScript: HookScriptShape | null = job?.script
    ? (() => {
        try {
          return JSON.parse(job.script!) as HookScriptShape;
        } catch {
          return null;
        }
      })()
    : null;

  const running = job && job.status !== 'done' && job.status !== 'failed';

  return (
    <div className="max-w-xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">후킹형 제휴 쇼츠 생성기 <span className="text-sm text-gray-400">(관리자)</span></h1>

      <div className="space-y-3">
        <Field label="제품명 *">
          <input className="input" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="예: 스노우드림 카본 러닝화" />
        </Field>
        <Field label="셀링포인트 * (쉼표/줄바꿈 구분)">
          <textarea className="input h-20" value={sellingPoints} onChange={(e) => setSellingPoints(e.target.value)} placeholder="초박형 카본판, 초경량, 고탄력 쿠션" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="타깃"><input className="input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="러너/입문자" /></Field>
          <Field label="톤"><input className="input" value={tone} onChange={(e) => setTone(e.target.value)} placeholder="키네틱" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="훅 각도">
            <select className="input" value={angle} onChange={(e) => setAngle(e.target.value as (typeof ANGLES)[number])}>
              {ANGLES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="음악 톤">
            <select className="input" value={musicTone} onChange={(e) => setMusicTone(e.target.value)}>
              {MUSIC_TONES.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="브랜드 표기 (CTA용)"><input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="비우면 제품명 사용" /></Field>
        <Field label="쿠팡 파트너스 링크"><input className="input" value={affiliateUrl} onChange={(e) => setAffiliateUrl(e.target.value)} placeholder="https://link.coupang.com/a/..." /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="해상도">
            <select className="input" value={resolution} onChange={(e) => setResolution(e.target.value as '480p' | '720p')}>
              <option value="480p">480p (~$1.6)</option>
              <option value="720p">720p (~$3.7)</option>
            </select>
          </Field>
          <Field label="제품 사진 * (얼굴 없는 제품컷)">
            <input type="file" accept="image/*" onChange={(e) => setProductFile(e.target.files?.[0] ?? null)} />
          </Field>
        </div>
      </div>

      {err && <p className="text-red-600 text-sm">{err}</p>}

      <button onClick={submit} disabled={submitting || !!running} className="w-full py-3 bg-black text-white rounded-lg disabled:opacity-40">
        {running ? '생성 중…' : submitting ? '요청 중…' : '생성'}
      </button>

      {estCost != null && <p className="text-xs text-gray-500">예상 원가: ${estCost} (Seedance 2클립)</p>}

      {job && (
        <div className="border rounded-lg p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span>{job.status}</span><span>{job.progress}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded"><div className="h-2 bg-black rounded" style={{ width: `${job.progress}%` }} /></div>
          {job.error && <p className="text-red-600 text-sm">⚠️ {job.error}</p>}
          {job.status === 'done' && job.videoUrl && (
            <div className="space-y-3 pt-2">
              <video src={job.videoUrl} controls className="w-full rounded-lg bg-black" style={{ maxHeight: 520 }} />
              <a href={job.videoUrl} download className="inline-block text-sm underline">영상 다운로드</a>
              {parsedScript && (
                <div>
                  <p className="text-sm font-semibold mb-1">설명란 (복붙용)</p>
                  <textarea readOnly className="input h-40 text-xs" value={parsedScript.description} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        .input { width: 100%; border: 1px solid #d1d5db; border-radius: 8px; padding: 8px 10px; font-size: 14px; }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
