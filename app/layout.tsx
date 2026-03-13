import type { Metadata } from 'next';
import './globals.css';
import Providers from '@/components/Providers';

export const metadata: Metadata = {
  title: 'ShortsAI - 사업장 홍보영상 자동 생성',
  description: '업체명과 사진만 입력하면 AI가 스크립트, 음성, BGM, 영상까지 자동으로 만들어드립니다. 한국어 완벽 지원.',
  keywords: '홍보영상, 사업장 홍보, 쇼츠 자동 생성, AI 영상 제작, SNS 마케팅',
  openGraph: {
    title: 'ShortsAI - 사업장 홍보영상 자동 생성',
    description: '업체명과 사진만 입력하면 AI가 홍보 쇼츠 영상을 자동으로 만들어드립니다',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* Pretendard — 한국어 가변 폰트 */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
