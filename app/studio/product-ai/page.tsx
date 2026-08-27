import { PromoCharacterTool } from '@/app/promo-character/page';
import MenuSample from '@/components/MenuSample';

export const metadata = { title: '제품 홍보영상 (캐릭터2)' };

export default function Page() {
  return (
    <>
      <MenuSample menuKey="product-ai" />
      <PromoCharacterTool embedded engine="visionstory-ai" />
    </>
  );
}
