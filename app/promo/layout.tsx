import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '홍보영상 만들기 - 3분이면 완성',
  description: '업체명, 업종, 사진만 입력하면 AI가 스크립트·음성·BGM·영상까지 자동 생성합니다. 지금 무료로 만들어보세요.',
  openGraph: {
    title: 'ShortsAI - 홍보영상 만들기',
    description: '업체명과 사진만 입력하면 3분 만에 홍보 쇼츠 영상이 완성됩니다.',
  },
  alternates: {
    canonical: 'https://shortsai.kr/promo',
  },
};

export default function PromoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
