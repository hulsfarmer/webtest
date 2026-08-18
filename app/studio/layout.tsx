import type { Metadata } from 'next';
import './studio.css';
import StudioShell from '@/components/studio/StudioShell';

export const metadata: Metadata = {
  title: 'Studio',
  robots: { index: false, follow: false }, // 로그인 후 작업공간 — 검색 비노출
};

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <StudioShell>{children}</StudioShell>;
}
