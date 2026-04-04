'use client';

import { useState } from 'react';
import { Loader2, Wand2, AlertCircle } from 'lucide-react';

interface VideoScript {
  title: string;
  hashtags: string[];
  sections: Array<{ type: string; text: string; duration: number }>;
  totalDuration: number;
  bgKeyword: string;
}

interface RevisePanelProps {
  script: VideoScript;
  sessionId: string;
  voice: string;
  speed: number;
  /** 'purple' for ShortsAI, 'emerald' for PromoAI */
  color: 'purple' | 'emerald';
  onReviseStart: (newJobId: string) => void;
}

const SUGGESTIONS: Record<'purple' | 'emerald', string[]> = {
  purple: [
    '더 짧게 ✂️',
    '더 재미있게 🎉',
    '더 설득력있게 💪',
    'CTA 강하게 🔥',
    '처음 훅 더 강렬하게',
    '톤을 더 친근하게',
  ],
  emerald: [
    '더 짧게 ✂️',
    '더 설득력있게 💪',
    'CTA 더 강하게 🔥',
    '가격 혜택 강조',
    '더 긴급한 느낌으로',
    '톤을 더 친근하게',
  ],
};

const ACCENT: Record<'purple' | 'emerald', {
  bg: string;
  border: string;
  text: string;
  badge: string;
  button: string;
  chip: string;
  chipActive: string;
}> = {
  purple: {
    bg:       'bg-purple-500/10',
    border:   'border-purple-500/25',
    text:     'text-purple-300',
    badge:    'bg-purple-500/20 text-purple-200',
    button:   'bg-gradient-to-r from-purple-600 to-pink-600',
    chip:     'bg-white/5 border-white/10 text-gray-400 hover:border-purple-500/30 hover:text-purple-300',
    chipActive: 'bg-purple-500/20 border-purple-500/40 text-purple-200',
  },
  emerald: {
    bg:       'bg-emerald-500/10',
    border:   'border-emerald-500/25',
    text:     'text-emerald-300',
    badge:    'bg-emerald-500/20 text-emerald-200',
    button:   'bg-gradient-to-r from-emerald-600 to-teal-600',
    chip:     'bg-white/5 border-white/10 text-gray-400 hover:border-emerald-500/30 hover:text-emerald-300',
    chipActive: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200',
  },
};

export default function RevisePanel({
  script,
  sessionId,
  voice,
  speed,
  color,
  onReviseStart,
}: RevisePanelProps) {
  const [feedback, setFeedback]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [activeChip, setActiveChip] = useState<string | null>(null);

  const ac = ACCENT[color];

  function applySuggestion(s: string) {
    // strip emoji suffix for cleaner text
    const clean = s.replace(/\s*[✂️🎉💪🔥]/g, '').trim();
    setFeedback(clean);
    setActiveChip(s);
  }

  async function submit() {
    const trimmed = feedback.trim();
    if (!trimmed) return;
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalScript: script,
          feedback: trimmed,
          sessionId,
          voice,
          speed,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '수정 요청에 실패했습니다.');

      // Reset local state before handing off to parent
      setFeedback('');
      setActiveChip(null);
      onReviseStart(data.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`glass-card p-5 space-y-4 border ${ac.border}`}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded-lg ${ac.bg}`}>
          <Wand2 className={`w-4 h-4 ${ac.text}`} />
        </div>
        <div>
          <p className="font-semibold text-sm text-white">AI로 수정하기</p>
          <p className="text-[11px] text-gray-500">영상을 보고 바꾸고 싶은 부분을 알려주세요 · 사용량 차감 없음</p>
        </div>
      </div>

      {/* Suggestion chips */}
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS[color].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => applySuggestion(s)}
            className={`px-2.5 py-1 rounded-full text-xs border transition-all ${
              activeChip === s ? ac.chipActive : ac.chip
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Feedback textarea */}
      <textarea
        value={feedback}
        onChange={(e) => { setFeedback(e.target.value); setActiveChip(null); }}
        placeholder="예: CTA를 더 강하게, 첫 문장을 더 충격적으로, 전체를 30초로 줄여줘..."
        rows={2}
        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white/25 transition-all resize-none text-sm"
      />

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
          <p className="text-red-300 text-xs">{error}</p>
        </div>
      )}

      {/* Submit */}
      <button
        onClick={submit}
        disabled={!feedback.trim() || submitting}
        className={`w-full py-3 rounded-xl text-white font-bold text-sm disabled:opacity-40 hover:opacity-90 transition-all flex items-center justify-center gap-2 ${ac.button}`}
      >
        {submitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            AI 수정 중...
          </>
        ) : (
          <>
            <Wand2 className="w-4 h-4" />
            수정 영상 생성
          </>
        )}
      </button>
    </div>
  );
}
