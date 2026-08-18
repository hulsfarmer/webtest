import ToolWorkspace, { type ToolConfig } from '@/components/studio/ToolWorkspace';

export const metadata = { title: '로고 생성' };

const config: ToolConfig = {
  eyebrow: 'AI 로고 스튜디오',
  title: '로고 생성',
  sub: '브랜드 이름과 분위기만 입력하면 다양한 로고 시안을 만들고 PNG·SVG·AI 파일로 내려받습니다.',
  fields: [
    { type: 'input', label: '브랜드명', placeholder: '예: HULS Coffee' },
    { type: 'select', label: '스타일', options: ['미니멀·모던', '클래식·고급', '귀여운·캐주얼', '볼드·강렬', '핸드드로잉'] },
    { type: 'textarea', label: '느낌·키워드', placeholder: '따뜻한 · 커피 · 제주 (쉼표로 구분)' },
    { type: 'drop', label: '참고 이미지', text: '원하는 분위기의 이미지를 올리면 반영합니다 (선택)' },
  ],
  preview: 'square',
  previewData: { name: 'HULS' },
  cta: '로고 만들기',
  ctaHref: 'https://logomaker-blush.vercel.app',
  ctaExternal: true,
};

export default function Page() {
  return <ToolWorkspace config={config} />;
}
