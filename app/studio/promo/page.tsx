import { Suspense } from 'react';
import { PromoTool } from '@/app/promo/page';

export const metadata = { title: '업체 홍보영상' };

export default function Page() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: 'var(--text-dim)' }}>불러오는 중…</div>}>
      <PromoTool embedded forceMode="business" />
    </Suspense>
  );
}
