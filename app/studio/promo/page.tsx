import ToolWorkspace, { type ToolConfig } from '@/components/studio/ToolWorkspace';

export const metadata = { title: '업체 홍보영상' };

const config: ToolConfig = {
  eyebrow: 'AI 홍보영상',
  title: '업체 홍보영상 만들기',
  sub: '업체 정보와 사진 몇 장이면, 클로드가 대본·음성·자막까지 붙여 세로 홍보 쇼츠를 자동 생성합니다.',
  fields: [
    { type: 'input', label: '업체명', placeholder: '예: 함덕 감성카페' },
    { type: 'select', label: '업종', options: ['카페·디저트', '음식점', '뷰티·미용', '헬스·운동', '병원·의료', '농장·직거래', '교육·학원', '기타'] },
    { type: 'textarea', label: '핵심 강점', placeholder: '직접 로스팅 · 오션뷰 · 시그니처 라떼 (쉼표로 구분)' },
    { type: 'chips', label: '톤', options: ['친근한', '전문적인', '긴급한', '따뜻한'] },
    { type: 'drop', label: '사진 첨부', text: '없으면 업종에 맞는 스톡 영상 배경이 자동으로 들어갑니다 (선택)' },
  ],
  preview: 'vertical',
  previewData: { name: '함덕 감성카페', capA: '매일 아침', capB: '향긋한 한 잔' },
  cta: '영상 생성하기',
  ctaHref: '/promo',
};

export default function Page() {
  return <ToolWorkspace config={config} />;
}
