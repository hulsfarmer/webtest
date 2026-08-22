import { PromoCharacterTool } from '@/app/promo-character/page';
import AdminOnly from '@/components/studio/AdminOnly';

export const metadata = { title: '제품 홍보영상 (AI배우)' };

export default function Page() {
  return (
    <AdminOnly>
      <PromoCharacterTool embedded engine="visionstory-ai" />
    </AdminOnly>
  );
}
