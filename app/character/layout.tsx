import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '말하는 캐릭터 | ShortsAI',
  description: '캐릭터 이미지와 스크립트만 넣으면 자연스럽게 말하는 쇼츠 영상을 만들어 드립니다.',
};

export default function CharacterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
