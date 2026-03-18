import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '로그인',
  description: 'ShortsAI에 로그인하여 AI 홍보영상을 만들어보세요. Google 계정으로 간편 로그인.',
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: 'https://shortsai.kr/login',
  },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
