import ToolWorkspace, { type ToolConfig } from '@/components/studio/ToolWorkspace';

export const metadata = { title: '제품 홍보영상' };

const config: ToolConfig = {
  eyebrow: '말하는 캐릭터',
  title: '제품 홍보영상 만들기',
  sub: '말하는 캐릭터가 제품을 직접 소개하는 드라마형 쇼츠. 음성·표정·자막이 자동으로 맞춰집니다.',
  fields: [
    { type: 'input', label: '제품명', placeholder: '예: 수제 그래놀라' },
    { type: 'select', label: '캐릭터', options: ['밝은 20대 여성', '차분한 30대 남성', '친근한 아이', '전문가 톤'] },
    { type: 'textarea', label: '소개 포인트', placeholder: '무설탕 · 국산 재료 · 바삭함 (쉼표로 구분)' },
    { type: 'chips', label: '길이', options: ['15초', '30초', '45초'] },
    { type: 'drop', label: '제품 사진', text: '제품 사진을 올리면 화면에 함께 노출됩니다 (선택)' },
  ],
  preview: 'vertical',
  previewData: { name: '수제 그래놀라', capA: '이 제품이', capB: '왜 특별하냐면' },
  cta: '영상 생성하기',
  ctaHref: '/promo-character',
};

export default function Page() {
  return <ToolWorkspace config={config} />;
}
