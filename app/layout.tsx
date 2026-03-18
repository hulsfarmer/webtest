import type { Metadata } from 'next';
import './globals.css';
import Providers from '@/components/Providers';

const SITE_URL = 'https://shortsai.kr';
const SITE_NAME = 'ShortsAI';
const SITE_TITLE = 'ShortsAI - AI 사업장 홍보영상 자동 생성 | 3분 완성';
const SITE_DESC = '업체명과 사진만 입력하면 AI가 스크립트, 음성, BGM, 영상까지 자동으로 만들어드립니다. 카페·식당·헬스장·미용실 등 업종별 최적화. 한국어 완벽 지원. 무료로 시작하세요.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: '%s | ShortsAI',
  },
  description: SITE_DESC,
  keywords: [
    '홍보영상', '홍보영상 만들기', '사업장 홍보', '가게 홍보',
    '쇼츠 자동 생성', 'AI 영상 제작', 'SNS 마케팅',
    '유튜브 쇼츠', '인스타 릴스', '틱톡 영상',
    '카페 홍보', '식당 홍보', '헬스장 홍보', '미용실 홍보',
    '자영업 마케팅', '소상공인 홍보', '영상 제작 AI',
  ],
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  formatDetection: {
    telephone: false,
    email: false,
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESC,
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: 'ko_KR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESC,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: SITE_URL,
  },
  verification: {
    // 나중에 Google Search Console 인증 시 추가
    // google: 'verification-code',
  },
  category: 'technology',
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
        {/* 구조화 데이터 — SoftwareApplication (Google 검색 강화) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'SoftwareApplication',
              name: 'ShortsAI',
              applicationCategory: 'MultimediaApplication',
              operatingSystem: 'Web',
              url: SITE_URL,
              description: SITE_DESC,
              offers: [
                {
                  '@type': 'Offer',
                  price: '0',
                  priceCurrency: 'KRW',
                  name: 'Free',
                  description: '월 3회 홍보영상, 무료',
                },
                {
                  '@type': 'Offer',
                  price: '9900',
                  priceCurrency: 'KRW',
                  name: 'Pro',
                  description: '월 30회 홍보영상',
                },
                {
                  '@type': 'Offer',
                  price: '29000',
                  priceCurrency: 'KRW',
                  name: 'Business',
                  description: '월 100회 홍보영상',
                },
              ],
              aggregateRating: {
                '@type': 'AggregateRating',
                ratingValue: '4.8',
                ratingCount: '50',
              },
            }),
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
