'use client';

import { Star } from 'lucide-react';

const testimonials = [
  {
    name: '김사장님',
    business: '카페 사장님',
    emoji: '☕',
    rating: 5,
    text: '업체 사진 몇 장 올렸더니 진짜 3분 만에 홍보 쇼츠가 나왔어요. 영상 제작 업체에 맡기면 50만원인데, 이건 무료라니!',
  },
  {
    name: '박대표님',
    business: '헬스장 대표님',
    emoji: '💪',
    rating: 5,
    text: '인스타 릴스용 영상이 필요했는데 딱이에요. 나레이션까지 자동이라 편하고, BGM도 분위기에 맞게 나와서 바로 올렸습니다.',
  },
  {
    name: '이원장님',
    business: '미용실 원장님',
    emoji: '✂️',
    rating: 5,
    text: '매장 리뉴얼하고 홍보영상 만들고 싶었는데 비용이 부담됐거든요. 여기서 만들어보니까 퀄리티가 생각보다 좋아서 놀랐어요.',
  },
  {
    name: '최사장님',
    business: '부동산 대표님',
    emoji: '🏠',
    rating: 5,
    text: '매물 홍보영상을 매번 만들기 힘들었는데, 사진이랑 특징만 넣으면 바로 영상이 나와서 매물 올릴 때마다 활용하고 있어요.',
  },
];

export default function TestimonialsSection() {
  return (
    <section className="py-20 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3">
            사장님들의 <span className="gradient-text">솔직 후기</span>
          </h2>
          <p className="text-gray-400">ShortsAI를 먼저 사용해본 사장님들의 이야기</p>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {testimonials.map((t) => (
            <div
              key={t.name}
              className="bg-brand-card border border-white/10 rounded-2xl p-5 hover:border-purple-500/30 transition-all"
            >
              {/* Header */}
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-lg">
                  {t.emoji}
                </div>
                <div>
                  <div className="font-semibold text-white text-sm">{t.name}</div>
                  <div className="text-gray-500 text-xs">{t.business}</div>
                </div>
                <div className="ml-auto flex gap-0.5">
                  {Array.from({ length: t.rating }).map((_, i) => (
                    <Star key={i} className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
              </div>

              {/* Review text */}
              <p className="text-gray-300 text-sm leading-relaxed">
                &ldquo;{t.text}&rdquo;
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
