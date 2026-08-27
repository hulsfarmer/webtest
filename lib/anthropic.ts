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

/**
 * 유튜브 태그(검색 키워드) AI 생성 — 한국어 명사 키워드 위주 10~13개.
 * 실패 시 throw (호출측에서 휴리스틱 buildYouTubeTags 로 폴백).
 */
export async function generateYouTubeTags(businessName: string, catchphrase: string, narration: string): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 없음');
  const prompt = `아래 홍보 영상 정보로 유튜브 태그(검색 키워드)를 만들어줘.
업체/제품명: ${businessName}
홍보문구: ${catchphrase}
나레이션: ${narration}

규칙:
- 한국어 명사 키워드 위주 (조사·동사·문장·어미 금지, 예: "네일아트" O / "예약하시면" X)
- 이 업종/제품을 유튜브·검색에서 찾을 때 실제로 칠 검색어로
- 업체명, 핵심 품목/서비스, 관련 상위 카테고리를 포함
- "쇼츠", "홍보영상" 같은 일반 태그 2~3개도 포함
- 총 10~13개, 각 태그는 2~12자
- 출력은 JSON 배열만: ["태그1","태그2", ...]`;
  const message = await getClient().messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });
  const c = message.content[0];
  if (c.type !== 'text') throw new Error('unexpected tag response');
  const raw = c.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const arr = JSON.parse(raw) as unknown;
  if (!Array.isArray(arr)) throw new Error('tag response not array');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of arr) {
    const v = String(t).replace(/[#*_`~]/g, '').replace(/[.,!?…·]/g, '').trim();
    if (!v || v.length < 2 || v.length > 30) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(v);
    if (out.length >= 15) break;
  }
  if (!out.length) throw new Error('no tags parsed');
  return out;
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
  headerTheme?: string;
  beatPulse?: boolean;
  mode?: 'business' | 'event';
  eventDate?: string;
  characterName?: string; // 발표 캐릭터 이름 (인트로 자기소개용)
}

// AI가 제목에 업체명/행사명을 다시 넣는 경우 제거 (상단 밴드에 이름이 이미 별도 표기됨)
function stripNameFromTitle(title: string, name?: string): string {
  if (!title) return title;
  const original = title.trim();
  let t = original;
  const n = (name || '').trim();
  if (n) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`\\s*[-–—~|:,]*\\s*${esc}\\s*[-–—~|:,]*\\s*`, 'g'), ' ');
    t = t.replace(/\s{2,}/g, ' ').trim();
    t = t.replace(/^[-–—~|:,\s]+|[-–—~|:,\s]+$/g, '').trim();
  }
  // AI가 조사 "의" 앞에 공백을 넣는 오타 교정 (예: "하나 의 신념" → "하나의 신념")
  // 홀로 선 "의"는 사실상 항상 앞 명사에 붙는 소유격 조사이므로 안전하게 병합
  t = t.replace(/(\S)\s+의(\s|$)/g, '$1의$2').replace(/\s{2,}/g, ' ').trim();
  return t || original; // 전부 지워지면 원본 유지
}

export async function generatePromoScript(input: PromoInput): Promise<VideoScript> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return getMockPromoScript(input);
  }

  const { businessName, businessType, sellingPoints, cta, duration, tone, mode, eventDate, location, characterName } = input;
  // 한국어 나레이션 속도 ≈ 초당 5.5자(공백 포함). 목표 길이에 맞춰 전체 글자 수 예산 산출.
  const charBudget = Math.max(60, Math.round(duration * 5.5));
  // 구간별 목표 글자수 (인트로 22% / 제품소개 56% / 마무리 22%)
  const hookChars = Math.round(charBudget * 0.22);
  const mainChars = Math.round(charBudget * 0.56);
  const ctaChars = Math.round(charBudget * 0.22);
  // 발표 캐릭터 이름이 있으면 인트로(hook)에서 이름을 각인. 자기소개형/훅녹임은 제품·톤에 맞춰 AI 판단.
  const nameRule = characterName
    ? `\n- **발표자(캐릭터) 이름은 "${characterName}"** — 첫 문장(hook)에서 이 이름으로 화자를 자연스럽게 소개해줘. 제품·톤에 맞게 '안녕하세요, ${characterName}입니다…' 자기소개형이든, 강한 훅 안에 이름을 녹이든 AI가 판단하되 **이름은 반드시 한 번, 어색하지 않게**`
    : '';

  const businessPrompt = `SNS 홍보 영상 스크립트를 한국어로 작성해주세요.

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
      "text": "첫 3초에 스크롤을 멈추게 하는 강력한 훅 — 질문·반전·숫자·호기심 중 하나로 시작(뻔한 인사말 금지). 예: '이 가격, 실화예요?' / '왜 여기만 줄 서는지 아세요?' / '딱 3초만 보고 가세요'",
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
- **첫 문장(hook)은 스크롤을 멈추게 임팩트 있게**, 전체는 짧고 리듬감 있는 문장 + 생생한 동사·감탄으로 지루하지 않게 (선택한 톤 "${tone}"은 유지하되 밋밋하지 않게)
- **말투는 반드시 존댓말** — 친근한·따뜻한·긴급한 톤은 해요체("~해요/~예요/지금 오세요")로 따뜻하고 다정하게, 전문적인 톤은 정중한 합니다체("~합니다/~입니다")로. 처음 보는 고객에게 거는 광고이므로 **반말은 절대 쓰지 마.**
- **이모지는 절대 사용하지 마** — 제목·문장·CTA 어디에도 이모지 금지 (텍스트만)
- **각 문장에서 핵심 단어 2개 정도를 각각 별표(*)로 감싸** 강조 (각각 한 단어씩, 예: '매일 *직접* 구운 *빵*'). 조사 빼고 명사·형용사 위주로 짧게
- bgKeyword는 업종(${businessType})에 어울리는 영어 스톡영상 검색어
- ⚠️ **길이 규칙(가장 중요, 반드시 준수)**: 총 ${duration}초 영상이야(초당 약 5.5자). **전체 나레이션(모든 구간 text 합)을 한국어 ${charBudget}자 이내로 반드시 맞춰줘.** 구간별 목표 — 인트로(hook) ~${hookChars}자, 제품소개(main 전체 합) ~${mainChars}자, 마무리(cta) ~${ctaChars}자. **초과 절대 금지** (초과하면 영상이 길어지고 비용이 올라감). 내용이 많으면 가장 강한 핵심만 남기고 과감히 쳐내서 글자 수를 지켜줘 — 길게 늘어놓지 말 것${nameRule}`;

  const eventPrompt = `행사(이벤트) 홍보 영상 스크립트를 한국어로 작성해주세요.

행사명: ${businessName}
행사 종류: ${businessType}
일시: ${eventDate || '(미입력)'}
장소: ${location || '(미입력)'}
주요 내용·프로그램: ${sellingPoints}
영상 길이: ${duration}초
톤: ${tone}
원하는 마무리 멘트: ${cta || '참여·방문 유도'}

다음 JSON 형식으로 응답해주세요 (코드 블록 없이 순수 JSON만):
{
  "title": "행사를 알리는 임팩트 있는 캐치프레이즈 제목 (20자 이내, 예: '이번 주말, 놓치지 마세요')",
  "bgKeyword": "배경으로 쓸 Pexels 스톡 영상 검색어 (영어 1-2단어, 행사 분위기에 맞게, 예: festival crowd, live concert, street market)",
  "hashtags": ["해시태그1", "해시태그2", "해시태그3", "해시태그4", "해시태그5"],
  "sections": [
    {
      "type": "hook",
      "text": "첫 3초에 설렘·호기심을 폭발시키는 훅 — 질문·반전·카운트다운 중 하나로 시작(행사명 자연스럽게, 뻔한 인사말 금지). 예: '이번 주말, 여기 안 가면 후회해요' / '딱 이틀만 열립니다'",
      "duration": 5
    },
    {
      "type": "main",
      "text": "주요 볼거리·프로그램 1 소개",
      "duration": ${Math.floor(duration * 0.25)}
    },
    {
      "type": "main",
      "text": "추가 프로그램·즐길거리·혜택 소개",
      "duration": ${Math.floor(duration * 0.25)}
    },
    {
      "type": "main",
      "text": "일시와 장소를 명확히 안내 (예: 'O월 O일, OO에서 만나요')",
      "duration": ${Math.floor(duration * 0.2)}
    },
    {
      "type": "cta",
      "text": "지금 아니면 놓친다는 긴급성으로 참여를 유도하는 마무리 (일시·장소 다시 강조, 전화번호는 넣지 말 것)",
      "duration": ${Math.floor(duration * 0.15)}
    }
  ],
  "totalDuration": ${duration}
}

중요:
- 각 section의 text는 TTS로 읽기 자연스럽게 작성 (음성으로 읽을 내용)
- 행사명(${businessName})을 hook에 자연스럽게 포함
- **일시(${eventDate || '미입력'})와 장소(${location || '미입력'})는 반드시 스크립트에 음성으로 안내** (행사는 언제·어디서가 가장 중요)
- 전화번호 등 세부 연락처는 스크립트에 넣지 마세요 (화면 하단에 자동 표시됩니다)
- 마감·한정·선착순 같은 긴급성을 살려 참여를 유도
- **첫 문장(hook)은 스크롤을 멈추게 임팩트 있게**, 전체는 짧고 경쾌한 리듬 + 생생한 표현으로 지루하지 않게 (선택한 톤 "${tone}" 유지)
- **말투는 반드시 존댓말** — 친근한·따뜻한·긴급한 톤은 해요체("~해요/~예요/지금 오세요")로 따뜻하고 다정하게, 전문적인 톤은 정중한 합니다체("~합니다/~입니다")로. 처음 보는 고객에게 거는 광고이므로 **반말은 절대 쓰지 마.**
- **이모지는 절대 사용하지 마** — 제목·문장·CTA 어디에도 이모지 금지 (텍스트만)
- **각 문장에서 핵심 단어 2개 정도를 각각 별표(*)로 감싸** 강조 (각각 한 단어씩, 예: '이번 *주말* *단이틀* 놓치지 마세요'). 조사 빼고 명사·형용사 위주로 짧게
- bgKeyword는 행사 분위기(${businessType})에 어울리는 영어 스톡영상 검색어
- ⚠️ **길이 규칙(가장 중요, 반드시 준수)**: 총 ${duration}초 영상이야(초당 약 5.5자). **전체 나레이션(모든 구간 text 합)을 한국어 ${charBudget}자 이내로 반드시 맞춰줘.** 구간별 목표 — 인트로(hook) ~${hookChars}자, 제품소개(main 전체 합) ~${mainChars}자, 마무리(cta) ~${ctaChars}자. **초과 절대 금지** (초과하면 영상이 길어지고 비용이 올라감). 내용이 많으면 가장 강한 핵심만 남기고 과감히 쳐내서 글자 수를 지켜줘 — 길게 늘어놓지 말 것${nameRule}`;

  const message = await getClient().messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: mode === 'event' ? eventPrompt : businessPrompt,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude');
  }

  try {
    const raw = content.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(raw) as VideoScript;
    parsed.title = stripNameFromTitle(parsed.title, input.businessName);
    return parsed;
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

  const { businessName, businessType, sellingPoints, cta, duration, tone, mode, eventDate, location } = input;
  const isEvent = mode === 'event';
  const subject = isEvent ? '행사' : '업체';
  const n = imagePaths.length;
  const perDuration = Math.floor(duration / n);

  const sectionSpecs = imagePaths.map((_, i) => ({
    type: i === 0 ? 'hook' : i === n - 1 && n > 1 ? 'cta' : 'main',
    duration: perDuration,
  }));

  const infoLines = isEvent
    ? `행사명: ${businessName}\n행사 종류: ${businessType}\n일시: ${eventDate || '(미입력)'}\n장소: ${location || '(미입력)'}\n주요 내용·프로그램: ${sellingPoints}`
    : `업체명: ${businessName}\n업종: ${businessType}\n핵심 홍보 포인트: ${sellingPoints}`;

  const rules = isEvent
    ? `- 각 섹션의 text는 해당 사진(순서대로)의 장면/분위기와 자연스럽게 연결되도록
- 행사명(${businessName})을 첫 섹션에 자연스럽게 포함
- **일시(${eventDate || '미입력'})와 장소(${location || '미입력'})는 반드시 스크립트에 음성으로 안내** (행사는 언제·어디서가 가장 중요)
- 마감·한정·선착순 같은 긴급성을 살려 참여를 유도
- 전화번호 등 세부 연락처는 스크립트에 넣지 마세요 (화면 하단에 자동 표시됩니다)
- text는 TTS로 읽기 자연스러운 한국어 (음성으로 읽을 내용)
- bgKeyword는 행사 분위기(${businessType})에 어울리는 영어 스톡영상 검색어`
    : `- 각 섹션의 text는 해당 사진(순서대로)의 장면/분위기와 자연스럽게 연결되도록
- 업체명(${businessName})을 첫 섹션에 자연스럽게 포함
- 전화번호, 주소, 연락처 등 구체적인 연락 정보는 절대 스크립트에 포함하지 마세요
- text는 TTS로 읽기 자연스러운 한국어 (음성으로 읽을 내용)
- bgKeyword는 업종(${businessType})에 어울리는 영어 스톡영상 검색어`;

  const message = await getClient().messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          ...imagePaths.map(fileToImageBlock),
          {
            type: 'text',
            text: `위 ${n}장의 ${subject} 사진을 순서대로 사용하여 ${isEvent ? '행사(이벤트)' : 'SNS'} 홍보 영상 스크립트를 한국어로 작성해주세요.

${infoLines}
영상 길이: ${duration}초
톤: ${tone}
${isEvent ? '원하는 마무리 멘트' : 'CTA'}: ${cta || (isEvent ? '참여·방문 유도' : '방문 또는 검색 유도')}
섹션 수: ${n}개 (사진 1장당 섹션 1개)

다음 JSON 형식으로 응답해주세요 (코드 블록 없이 순수 JSON만):
{
  "title": "캐치프레이즈 형식의 영상 제목 — ${subject}명을 그대로 반복하지 말고, ${isEvent ? '행사의 기대감·핵심을' : '핵심 혜택·차별점을'} 임팩트 있게 20자 이내로 요약",
  "bgKeyword": "배경 Pexels 검색어 (영어 1-2단어, 사진 없을 때 대체용)",
  "hashtags": ["해시태그1", "해시태그2", "해시태그3", "해시태그4", "해시태그5"],
  "sections": [
    ${sectionSpecs.map((s, i) => JSON.stringify({
      type: s.type,
      text: `사진 ${i + 1}의 장면에 어울리는 ${s.type === 'hook' ? `첫 3초에 스크롤을 멈추게 하는 강력한 훅 — 질문·반전·숫자·호기심 중 하나로 (${subject}명 자연스럽게, 뻔한 인사말 금지)` : s.type === 'cta' ? (isEvent ? '참여 유도 마무리 멘트 (일시·장소 강조)' : '방문/문의 유도 마무리 멘트') : (isEvent ? '볼거리·프로그램 멘트' : '핵심 홍보 포인트 멘트')}`,
      duration: s.duration,
    })).join(',\n    ')}
  ],
  "totalDuration": ${duration}
}

중요:
${rules}
- 첫 문장(hook)은 스크롤을 멈추게 임팩트 있게, 전체는 짧고 리듬감 있게 생생한 표현으로 지루하지 않게 (선택한 톤 "${tone}" 유지)
- **말투는 반드시 존댓말** — 친근한·따뜻한·긴급한 톤은 해요체("~해요/~예요/지금 오세요")로 따뜻하고 다정하게, 전문적인 톤은 정중한 합니다체("~합니다/~입니다")로. 처음 보는 고객에게 거는 광고이므로 **반말은 절대 쓰지 마.**
- 이모지는 절대 사용하지 마 — 제목·문장·CTA 어디에도 이모지 금지 (텍스트만)
- 각 문장에서 핵심 단어 2개 정도를 각각 별표(*)로 감싸 강조 (각각 한 단어씩, 예: '매일 *직접* 구운 *빵*'). 조사 빼고 명사·형용사 위주로 짧게`,
          },
        ],
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    const raw = content.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(raw) as VideoScript;
    parsed.title = stripNameFromTitle(parsed.title, input.businessName);
    return parsed;
  } catch {
    throw new Error('Claude returned invalid JSON: ' + content.text.slice(0, 200));
  }
}

function getMockPromoScript(input: PromoInput): VideoScript {
  const { businessName, businessType, duration } = input;
  return {
    title: `지금 바로 방문하세요!`,
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
    model: 'claude-sonnet-5',
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
- **말투는 존댓말 유지(해요체/합니다체), 반말로 바꾸지 마세요** (수정 요청에 명시적으로 반말 지시가 없는 한)
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
