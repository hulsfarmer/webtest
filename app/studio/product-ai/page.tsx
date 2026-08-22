import { PromoCharacterTool } from '@/app/promo-character/page';

export const metadata = { title: '제품 홍보영상 (캐릭터2)' };

export default function Page() {
  return <PromoCharacterTool embedded engine="visionstory-ai" />;
}
