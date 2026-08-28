import { PromoCharacterTool } from '@/app/promo-character/page';
import MenuSample from '@/components/MenuSample';

export const metadata = { title: '제품홍보영상 (premium)' };

export default function Page() {
  return (
    <>
      <MenuSample menuKey="product-ai" />
      <PromoCharacterTool embedded engine="visionstory-ai" />
    </>
  );
}
