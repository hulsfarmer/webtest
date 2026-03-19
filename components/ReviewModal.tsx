'use client';

import { useState } from 'react';
import { Star, X, Send, Loader2 } from 'lucide-react';

interface ReviewModalProps {
  jobId?: string;
  onClose: () => void;
  onSubmitted: () => void;
}

export default function ReviewModal({ jobId, onClose, onSubmitted }: ReviewModalProps) {
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [text, setText] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const businessOptions = ['카페', '식당', '헬스장', '미용실', '네일샵', '꽃집', '베이커리', '학원', '부동산', '병원', '기타'];

  const handleSubmit = async () => {
    if (text.trim().length < 5) {
      setError('후기는 최소 5글자 이상 작성해주세요');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          text: text.trim(),
          displayName: displayName.trim() || undefined,
          businessType: businessType || undefined,
          jobId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '후기 저장에 실패했습니다');
        return;
      }
      onSubmitted();
    } catch {
      setError('네트워크 오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md glass-card rounded-2xl p-6 relative">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-bold text-white mb-1">후기 남기기</h3>
        <p className="text-gray-400 text-sm mb-5">ShortsAI 사용 경험을 공유해주세요!</p>

        {/* Star Rating */}
        <div className="mb-5">
          <label className="text-gray-400 text-sm mb-2 block">별점</label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n)}
                onMouseEnter={() => setHoverRating(n)}
                onMouseLeave={() => setHoverRating(0)}
                className="transition-transform hover:scale-110"
              >
                <Star
                  className={`w-8 h-8 ${
                    n <= (hoverRating || rating)
                      ? 'fill-yellow-400 text-yellow-400'
                      : 'text-gray-600'
                  } transition-colors`}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Display Name */}
        <div className="mb-4">
          <label className="text-gray-400 text-sm mb-1.5 block">표시 이름 (선택)</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="예: 김사장님"
            maxLength={20}
            className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-purple-500/50"
          />
        </div>

        {/* Business Type */}
        <div className="mb-4">
          <label className="text-gray-400 text-sm mb-1.5 block">업종 (선택)</label>
          <div className="flex flex-wrap gap-2">
            {businessOptions.map((opt) => (
              <button
                key={opt}
                onClick={() => setBusinessType(businessType === opt ? '' : opt)}
                className={`px-3 py-1.5 rounded-full text-xs transition-all ${
                  businessType === opt
                    ? 'bg-purple-500/30 border-purple-500/50 text-purple-300'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'
                } border`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        {/* Review Text */}
        <div className="mb-5">
          <label className="text-gray-400 text-sm mb-1.5 block">후기 내용</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="영상 퀄리티, 사용 편의성 등 자유롭게 작성해주세요"
            maxLength={500}
            rows={3}
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-purple-500/50 resize-none"
          />
          <p className="text-gray-600 text-xs mt-1 text-right">{text.length}/500</p>
        </div>

        {error && (
          <p className="text-red-400 text-sm mb-3">{error}</p>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={loading || text.trim().length < 5}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-brand text-white font-bold hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <Send className="w-4 h-4" />
              후기 제출하기
            </>
          )}
        </button>

        <p className="text-gray-600 text-xs text-center mt-3">
          관리자 승인 후 홈페이지에 표시됩니다
        </p>
      </div>
    </div>
  );
}
