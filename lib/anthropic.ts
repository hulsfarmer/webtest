import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

export interface ScriptSection {
  type: 'hook' | 'main' | 'cta';
  text: string;
  duration: number;
}

export interface VideoScript {
  title: string;
  hashtags: string[];
  sections: ScriptSection[];
  totalDuration: number;
  bgKeyword: string; // Pexels 검색용 영어 키워드
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

function fileToImageBlock(imgPath: string): { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } } {
  const buffer = fs.readFileSync(imgPath);
  const base64 = buffer.toString('base64');
  const ext = path.extname(imgPath).slice(1).toLowerCase();
  const mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' =
    ext === 'png' ? 'image/png' :
    ext === 'webp' ? 'image/webp' :
    ext === 'gif' ? 'image/gif' :
    'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };
}

// ─────────────────────────────────────────────
// 홍보 영상 스크립트 생성
// ─────────────────────────────────────────────

export interface PromoInput {
  businessName: string;
  businessType: string;
  sellingPoints: string;
  contact?: string;
  location?: string;
  cta?: string;
  duration: number;
  tone: string;
}

export async function generatePromoScript(input: PromoInput): Promise<VideoScript> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return getMockPromoScript(input);
  }

  const { businessName, businessType, sellingPoints, cta, duration, tone } = input;

  const message = await getClient().messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `SNS 홍보 영상 스크립트를 한국어로 작성해주세요.

업체명: ${businessName}
업종: ${businessType}
핵심 홍보 포인트: ${sellingPoints}
영상 길이: ${duration}초
톤: ${tone}
원하는 CTA: ${cta || '방문 또는 검색 유도'}

다음 JSON 형식으로 응답해주세요 (코드 블록 없이 순수 JSON만):
{
  "title": "캐치프레이즈 형식의 영상 제목 — 업체명을 그대로 반복하지 말고, 핵심 혜택·차별점을 임팩트 있게 20자 이내로 요약 (예: '지금 바로 경험하세요', '가격은 낮추고 효과는 높이고')",
  "bgKeyword": "배경으로 쓸 Pexels 스톡 영상 검색어 (영어 1-2단어, 예: coffee shop, gym workout, restaurant food)",
  "hashtags": ["해시태그1", "해시태그2", "해시태그3", "해시태그4", "해시태그5"],
  "sections": [
    {
      "type": "hook",
      "text": "3-5초 안에 관심을 끄는 강력한 오프닝 (업체명 또는 핵심 혜택 언급)",
      "duration": 5
    },
    {
      "type": "main",
      "text": "핵심 홍보 포인트 1 자세히 설명",
      "duration": ${Math.floor(duration * 0.25)}
    },
    {
      "type": "main",
      "text": "핵심 홍보 포인트 2 / 차별화 강점",
      "duration": ${Math.floor(duration * 0.25)}
    },
    {
      "type": "main",
      "text": "핵심 홍보 포인트 3 / 고객 혜택",
      "duration": ${Math.floor(duration * 0.2)}
    },
    {
      "type": "cta",
      "text": "방문·문의 유도 마무리 멘트 (전화번호나 주소는 절대 포함하지 말 것)",
      "duration": ${Math.floor(duration * 0.15)}
    }
  ],
  "totalDuration": ${duration}
}

중요:
- 각 section의 text는 TTS로 읽기 자연스럽게 작성 (음성으로 읽을 내용)
- 업체명(${businessName})을 자연스럽게 포함
- 전화번호, 주소, 연락처 등 구체적인 연락 정보는 절대 스크립트에 포함하지 마세요 (화면 하단에 자동 표시됩니다)
- CTA는 방문 또는 검색 유도로만 마무리
- bgKeyword는 업종(${businessType})에 어울리는 영어 스톡영상 검색어
- 총 duration이 ${duration}초에 맞도록 조정`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude');
  }

  try {
    const raw = content.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(raw) as VideoScript;
  } catch {
    throw new Error('Claude returned invalid JSON: ' + content.text.slice(0, 200));
  }
}

export async function generatePromoScriptFromImages(
  imagePaths: string[],
  input: PromoInput,
): Promise<VideoScript> {
  if (!process.env.ANTHROPIC_API_KEY || imagePaths.length === 0) {
    return getMockPromoScript(input);
  }

  const { businessName, businessType, sellingPoints, cta, duration, tone } = input;
  const n = imagePaths.length;
  const perDuration = Math.floor(duration / n);

  const sectionSpecs = imagePaths.map((_, i) => ({
    type: i === 0 ? 'hook' : i === n - 1 && n > 1 ? 'cta' : 'main',
    duration: perDuration,
  }));

  const message = await getClient().messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          ...imagePaths.map(fileToImageBlock),
          {
            type: 'text',
            text: `위 ${n}장의 업체 사진을 순서대로 사용하여 SNS 홍보 영상 스크립트를 한국어로 작성해주세요.

업체명: ${businessName}
업종: ${businessType}
핵심 홍보 포인트: ${sellingPoints}
영상 길이: ${duration}초
톤: ${tone}
CTA: ${cta || '방문 또는 검색 유도'}
섹션 수: ${n}개 (사진 1장당 섹션 1개)

다음 JSON 형식으로 응답해주세요 (코드 블록 없이 순수 JSON만):
{
  "title": "캐치프레이즈 형식의 영상 제목 — 업체명을 그대로 반복하지 말고, 핵심 혜택·차별점을 임팩트 있게 20자 이내로 요약 (예: '지금 바로 경험하세요', '가격은 낮추고 효과는 높이고')",
  "bgKeyword": "배경 Pexels 검색어 (영어 1-2단어, 사진 없을 때 대체용)",
  "hashtags": ["해시태그1", "해시태그2", "해시태그3", "해시태그4", "해시태그5"],
  "sections": [
    ${sectionSpecs.map((s, i) => JSON.stringify({
      type: s.type,
      text: `사진 ${i + 1}의 장면에 어울리는 ${s.type === 'hook' ? '강력한 홍보 훅 (업체명 포함)' : s.type === 'cta' ? '방문/문의 유도 마무리 멘트' : '핵심 홍보 포인트 멘트'}`,
      duration: s.duration,
    })).join(',\n    ')}
  ],
  "totalDuration": ${duration}
}

중요:
- 각 섹션의 text는 해당 사진(순서대로)의 장면/분위기와 자연스럽게 연결되도록
- 업체명(${businessName})을 첫 섹션에 자연스럽게 포함
- 전화번호, 주소, 연락처 등 구체적인 연락 정보는 절대 스크립트에 포함하지 마세요
- text는 TTS로 읽기 자연스러운 한국어 (음성으로 읽을 내용)
- bgKeyword는 업종(${businessType})에 어울리는 영어 스톡영상 검색어`,
          },
        ],
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    const raw = content.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(raw) as VideoScript;
  } catch {
    throw new Error('Claude returned invalid JSON: ' + content.text.slice(0, 200));
  }
}

function getMockPromoScript(input: PromoInput): VideoScript {
  const { businessName, businessType, duration } = input;
  return {
    title: `${businessName} - 지금 방문하세요!`,
    bgKeyword: 'business storefront',
    hashtags: [`#${businessName}`, `#${businessType}`, '#홍보', '#추천', '#지역맛집'],
    sections: [
      {
        type: 'hook',
        text: `${businessName}을 아직 모르셨나요? 지금 바로 확인해보세요!`,
        duration: 5,
      },
      {
        type: 'main',
        text: `저희 ${businessName}은 최고의 품질과 서비스를 제공합니다. 고객 만족이 최우선입니다.`,
        duration: Math.floor(duration * 0.25),
      },
      {
        type: 'main',
        text: `특별한 혜택과 다양한 서비스로 여러분을 기다립니다. 한번 방문하시면 단골이 되실 거예요.`,
        duration: Math.floor(duration * 0.25),
      },
      {
        type: 'main',
        text: `합리적인 가격에 최고의 경험을 드립니다. 주변 어디서도 찾기 힘든 특별함이 있습니다.`,
        duration: Math.floor(duration * 0.2),
      },
      {
        type: 'cta',
        text: `지금 바로 방문해주세요. ${businessName}이 여러분을 기다리고 있습니다!`,
        duration: Math.floor(duration * 0.15),
      },
    ],
    totalDuration: duration,
  };
}

// ─────────────────────────────────────────────
// AI 스크립트 수정 (revise)
// ─────────────────────────────────────────────

export async function reviseScript(
  originalScript: VideoScript,
  feedback: string,
): Promise<VideoScript> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ...originalScript,
      title: originalScript.title + ' (수정)',
      sections: originalScript.sections.map((s, i) =>
        i === 0 ? { ...s, text: `[${feedback}] ` + s.text } : s
      ),
    };
  }

  const message = await getClient().messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `다음 홍보 영상 스크립트를 수정 요청에 따라 수정해주세요.

원본 스크립트 (JSON):
${JSON.stringify(originalScript, null, 2)}

수정 요청: ${feedback}

중요사항:
- 같은 JSON 형식으로 응답해주세요 (코드 블록 없이 순수 JSON만)
- 수정 요청에 해당하는 부분만 바꾸고, 나머지는 최대한 유지
- bgKeyword는 영어로 유지
- totalDuration은 원본과 같거나 비슷하게 유지
- 모든 text는 TTS로 읽기 자연스러운 한국어로 작성
- 전화번호, 주소 등 연락 정보는 스크립트에 포함하지 마세요`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    const raw = content.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(raw) as VideoScript;
  } catch {
    throw new Error('Claude returned invalid JSON: ' + content.text.slice(0, 200));
  }
}
