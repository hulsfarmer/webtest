import { PromoCharacterTool } from '@/app/promo-character/page';
import AdminOnly from '@/components/studio/AdminOnly';

export const metadata = { title: '제품 홍보영상' };

export default function Page() {
  return (
    <AdminOnly>
      <PromoCharacterTool embedded />
    </AdminOnly>
  );
}
