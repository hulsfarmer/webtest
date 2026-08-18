import ToolWorkspace, { type ToolConfig } from '@/components/studio/ToolWorkspace';

export const metadata = { title: '행사 홍보영상' };

const config: ToolConfig = {
  eyebrow: 'AI 홍보영상',
  title: '행사 홍보영상 만들기',
  sub: '축제·마켓·세일·오픈 등 행사 일시와 장소를 넣으면 긴급성을 살린 홍보 쇼츠를 만듭니다.',
  fields: [
    { type: 'input', label: '행사명', placeholder: '예: 함덕 봄 플리마켓', param: 'businessName' },
    { type: 'input', label: '행사 종류', placeholder: '예: 축제·마켓', param: 'businessType' },
    { type: 'input', label: '일시', placeholder: '예: 5/17(토) 11:00 ~ 18:00', hint: '필수', param: 'eventDate' },
    { type: 'input', label: '장소', placeholder: '예: 함덕 해변 광장', hint: '필수', param: 'location' },
    { type: 'textarea', label: '프로그램·혜택', placeholder: '플리마켓 · 푸드트럭 · 버스킹 (쉼표로 구분)', param: 'topic' },
    { type: 'chips', label: '톤', options: ['긴급한', '따뜻한', '친근한'], param: 'tone' },
  ],
  preview: 'vertical',
  previewData: { name: '함덕 봄 플리마켓', capA: '이번 주말', capB: '놓치지 마세요' },
  cta: '영상 생성하기',
  ctaHref: '/promo?mode=event',
};

export default function Page() {
  return <ToolWorkspace config={config} />;
}
