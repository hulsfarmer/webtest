import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '내 영상 히스토리',
  description: '이전에 생성한 홍보영상을 확인하고 다시 다운로드하세요.',
  robots: { index: false, follow: false },
};

export default function HistoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
