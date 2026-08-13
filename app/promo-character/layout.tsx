import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '제품 홍보 캐릭터 영상 | ShortsAI',
  description: '제품 정보만 넣으면 AI 캐릭터가 소개하는 홍보 쇼츠(인트로·제품·마무리)를 자동으로 만들어 드립니다.',
};

export default function PromoCharacterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
