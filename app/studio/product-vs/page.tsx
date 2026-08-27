import { PromoCharacterTool } from '@/app/promo-character/page';
import MenuSample from '@/components/MenuSample';

export const metadata = { title: '제품 홍보영상' };

export default function Page() {
  return (
    <>
      <MenuSample menuKey="product-vs" />
      <PromoCharacterTool embedded engine="visionstory" />
    </>
  );
}
