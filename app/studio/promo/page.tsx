import { Suspense } from 'react';
import { PromoTool } from '@/app/promo/page';
import MenuSample from '@/components/MenuSample';

export const metadata = { title: '브랜드 소개 영상' };

export default function Page() {
  return (
    <>
      <MenuSample menuKey="promo" />
      <Suspense fallback={<div style={{ padding: 24, color: 'var(--text-dim)' }}>불러오는 중…</div>}>
        <PromoTool embedded forceMode="business" />
      </Suspense>
    </>
  );
}
