import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ShortsAI - 유튜브 쇼츠 자동 생성',
  description: '주제만 입력하면 AI가 스크립트, 음성, 영상까지 자동으로 만들어드립니다. 한국어 완벽 지원.',
  keywords: '유튜브 쇼츠, 자동 생성, AI, 쇼츠 만들기, 유튜브 자동화',
  openGraph: {
    title: 'ShortsAI - 유튜브 쇼츠 자동 생성',
    description: '주제만 입력하면 AI가 완성된 쇼츠 영상을 만들어드립니다',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
