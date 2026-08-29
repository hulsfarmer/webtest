// lib/hook-script.ts
// 후킹형 제휴 쇼츠의 카피(자막·CTA·설명란) 생성 — Claude(claude-sonnet-5) 사용.
//
// 후킹 공식: 훅(3초 생존) → 공감/문제 → 제품=답 → 증거 → CTA(링크).
// 자막 문자열 안에서 강조할 키워드는 *...* 로 감싼다 (assembly 렌더러가 시안색으로 강조).

import Anthropic from '@anthropic-ai/sdk';

export type HookAngle = '트렌드' | '가성비' | '공포' | '지목';

export interface HookScriptInput {
  productName: string;
  sellingPoints: string[];
  target?: string;
  tone?: string;
  angle: HookAngle;
  /** 브랜드/제품 표기 (CTA용). 없으면 productName 사용 */
  brand?: string;
  /** 쿠팡 파트너스 제휴 링크 (설명란에 삽입) */
  affiliateUrl?: string;
}

export interface HookScript {
  /** 화면 자막 4개 (순서: 훅→공감→답→증거). *키워드* 강조 마커 포함 가능 */
  captions: [string, string, string, string];
  /** CTA: 브랜드명 + 행동유도 문구 */
  cta: { brand: string; action: string };
  /** 유튜브/쇼츠 제목 (=훅) */
  title: string;
  /** 발행 설명란 (링크·해시태그·제휴고지 포함) */
  description: string;
  /** 해시태그 */
  hashtags: string[];
}

const ANGLE_GUIDE: Record<HookAngle, string> = {
  트렌드: '"요즘 다들 이거 쓴다"는 유행·FOMO 자극. 예: "요즘 러너들 다 이거 신는 이유"',
  가성비: '"비싸게 살 필요 없다"는 반전. 예: "비싼 카본화, 살 필요 없어요"',
  공포: '문제를 방치하면 생기는 나쁜 결과로 불안 자극. 예: "발 아픈데 계속 뛰면?"',
  지목: '특정 대상을 콕 집어 시선 고정. 예: "발 넓은 러너 주목"',
};

const AFFILIATE_DISCLOSURE =
  '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

function buildDescription(
  s: Omit<HookScript, 'description'>,
  affiliateUrl?: string
): string {
  const lines: string[] = [];
  lines.push(s.title);
  lines.push(s.captions[2].replace(/\*/g, '') + ' ' + s.captions[3].replace(/\*/g, ''));
  lines.push('');
  if (affiliateUrl) lines.push(`👉 구매 링크: ${affiliateUrl}`);
  lines.push('');
  lines.push(s.hashtags.map((h) => (h.startsWith('#') ? h : '#' + h)).join(' '));
  lines.push('');
  lines.push('──────────');
  lines.push(AFFILIATE_DISCLOSURE);
  return lines.join('\n');
}

/** 훅 각도 기반 카피 생성. ANTHROPIC 키 없으면 휴리스틱 목업 반환. */
export async function generateHookScript(input: HookScriptInput): Promise<HookScript> {
  const brand = input.brand || input.productName;

  if (!process.env.ANTHROPIC_API_KEY) {
    return mockHookScript(input, brand);
  }

  const sys = [
    '너는 한국 쇼츠 광고 카피라이터다. 쿠팡 파트너스 제휴 제품을 파는 세로 쇼츠(15초)용 카피를 쓴다.',
    '목표: 3초 안에 스크롤을 멈추게 하고, 사게 만든다. 정보 나열 금지, 감정·호기심·구매욕 자극.',
    '자막은 아주 짧게(한 줄 8~16자). 강조할 핵심 키워드는 *별표*로 감싼다.',
    '과장·AI 티 나는 상투어(압도적/완벽한/환상적 등) 금지. 건강기능식품이면 과대광고 표현 금지.',
    '반드시 아래 JSON 스키마로만 응답한다. 설명 문장 없이 JSON만.',
  ].join('\n');

  const schema = `{
  "captions": ["훅(=제목과 동일)", "공감/문제", "제품=답", "증거/스펙"],
  "cta": { "brand": "브랜드명", "action": "행동유도(예: 지금 만나보세요)" },
  "title": "훅 문구",
  "hashtags": ["#태그", "..."]
}`;

  const user = [
    `제품명: ${input.productName}`,
    `셀링포인트: ${input.sellingPoints.join(', ')}`,
    input.target ? `타깃: ${input.target}` : '',
    input.tone ? `톤: ${input.tone}` : '',
    `훅 각도: ${input.angle} — ${ANGLE_GUIDE[input.angle]}`,
    `브랜드 표기: ${brand}`,
    '',
    `아래 JSON 스키마로만 응답:\n${schema}`,
  ]
    .filter(Boolean)
    .join('\n');

  const message = await getClient().messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1024,
    system: sys,
    messages: [{ role: 'user', content: user }],
  });

  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const jsonText = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  const parsed = JSON.parse(jsonText) as {
    captions: string[];
    cta: { brand: string; action: string };
    title: string;
    hashtags: string[];
  };

  const captions = [
    parsed.captions[0] || parsed.title,
    parsed.captions[1] || '',
    parsed.captions[2] || '',
    parsed.captions[3] || '',
  ] as [string, string, string, string];

  const base: Omit<HookScript, 'description'> = {
    captions,
    cta: { brand: parsed.cta?.brand || brand, action: parsed.cta?.action || '지금 만나보세요' },
    title: parsed.title || captions[0],
    hashtags: parsed.hashtags?.length ? parsed.hashtags : ['#쿠팡추천'],
  };
  return { ...base, description: buildDescription(base, input.affiliateUrl) };
}

/** 키 없을 때 휴리스틱 목업 (개발/오프라인용). */
function mockHookScript(input: HookScriptInput, brand: string): HookScript {
  const sp = input.sellingPoints;
  const hookByAngle: Record<HookAngle, string> = {
    트렌드: `요즘 다들 *${input.productName}* 쓰는 이유`,
    가성비: `비싼 거 *살 필요 없어요*`,
    공포: `이거 모르고 사면 *후회해요*`,
    지목: `${input.target || '이런 분'} *주목*`,
  };
  const base: Omit<HookScript, 'description'> = {
    captions: [
      hookByAngle[input.angle],
      '문제는 *바로 이거*',
      sp[0] ? `${sp[0]}` : '이걸로 *해결*',
      sp[1] ? `${sp[1]}` : '만족도 *최고*',
    ],
    cta: { brand, action: '지금 만나보세요' },
    title: hookByAngle[input.angle].replace(/\*/g, ''),
    hashtags: ['#쿠팡추천', '#가성비', '#추천템'],
  };
  return { ...base, description: buildDescription(base, input.affiliateUrl) };
}

export { AFFILIATE_DISCLOSURE };
