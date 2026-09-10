// lib/real-ad-script.ts
// 추출 텍스트 → Claude 로 실사 광고 슬롯 초안(자막+나레이션) 생성.
// 원칙: 팩트만(과장 금지), 나레이션 숫자는 한글 native(TTS 오독 방지), 훅=고민3+의문형.
import Anthropic from '@anthropic-ai/sdk';

// 훅 고민별 마스코트 장면 지정 (Claude가 매핑)
export interface HookScene {
  text: string;                    // 고민 구 (예: "미끄럽고…")
  imgPrompt?: string;              // AI 일러스트 생성용 영어 프롬프트(캐릭터 동작·감정)
  // (스틱 폴백용 - 선택)
  pose?: string;
  face?: string;
  prop?: string;
  item?: boolean;
  itemLabel?: string;
}
export interface DraftSlot {
  kind: 'hook' | 'promo' | 'cta';
  lines: string[];          // hook: 고민 구들 / promo·cta: 자막(1~2줄)
  question?: string;        // hook 펀치라인
  scenes?: HookScene[];     // hook: 고민별 마스코트 장면
  price?: string;           // cta 가격 표기(자막용, 예: "15,900원")
  narration: string;
}
export interface AdDraft {
  productName: string;
  slots: DraftSlot[];
}

// 숫자+단위 native 한글 보정 (Claude가 대체로 처리하지만 잔여 디지트 안전망)
const NATIVE = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];
const NATIVE_UNITS = '장|개|가지|명|잔|벌|켤레|마리|권|대|칸|판|박스|세트';
export function hangulizeCounters(text: string): string {
  return text.replace(new RegExp(`(\\d+)\\s*(${NATIVE_UNITS})`, 'g'), (m, n, u) => {
    const v = parseInt(n, 10);
    return v >= 1 && v <= 10 ? `${NATIVE[v]} ${u}` : m;
  });
}

function clientOf(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 없음');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const SYS =
  '너는 한국 쇼핑 상세페이지 사실만으로 30초 세로 광고 쇼츠 스크립트를 쓰는 카피라이터 겸 연출가야. 규칙: ' +
  '(1) 주어진 팩트에 없는 내용/과장 절대 금지. ' +
  '(2) 나레이션의 모든 숫자·수량은 한글로 풀어써(3장->세 장, 3개->세 개, 5종->다섯 가지, 100x70->가로 백 세로 칠십, 15,900원->만 오천구백 원, 30도->삼십 도). ' +
  '(3) 훅은 이 제품이 해결하는 고민 3개(각 6~10자 짧은 구)와 마지막 의문형 질문 한 문장. ' +
  '(4) 각 고민마다 AI 일러스트용 영어 프롬프트(imgPrompt)를 써. 귀여운 오리지널 마스코트 캐릭터가 그 고민(문제)을 겪는 한 장면만 묘사 — 해결책·제품 좋은 모습·전환("then...")은 절대 넣지 마(훅은 문제만). 캐릭터의 불편한 동작·표정·감정 + 관련 소품(젖은 바닥, 물방울, 세탁기 등). 15~30단어, 영어, "the character"로 지칭. 예: "the character wincing and holding its neck in discomfort while wearing a lumpy U-shaped neck pillow, tiny red spark marks". ' +
  '(5) 자막(lines)은 6~14자로 짧게, 이모지 금지. ' +
  '(6) 오직 JSON만 출력(코드펜스·설명 없이). 한 줄 compact JSON으로, 문자열 값 안에 줄바꿈·제어문자 넣지 마.';

export async function generateAdDraft(productName: string, price: string, texts: string[]): Promise<AdDraft> {
  const facts = [`제품명: ${productName}`, price ? `가격: ${price}` : '', ...texts].filter(Boolean).join('\n');
  // 구조화 출력(tool-use)로 검증된 객체를 받는다 — JSON 파싱 취약성 제거
  const TOOL = {
    name: 'ad_script',
    description: '30초 세로 광고 쇼츠 스크립트',
    input_schema: {
      type: 'object' as const,
      properties: {
        hook: {
          type: 'object', properties: {
            pains: { type: 'array', items: { type: 'string' }, description: '고민 3개(짧은 구)' },
            question: { type: 'string' },
            scenes: {
              type: 'array', description: 'pains와 1:1(3개)',
              items: { type: 'object', properties: { text: { type: 'string' }, imgPrompt: { type: 'string', description: '영어, 마스코트가 문제만 연출' } }, required: ['text', 'imgPrompt'] },
            },
          }, required: ['pains', 'question', 'scenes'],
        },
        slots: { type: 'array', description: '제품등장 포함 4~5개', items: { type: 'object', properties: { caption: { type: 'string' }, narration: { type: 'string' } }, required: ['caption', 'narration'] } },
        cta: { type: 'object', properties: { caption: { type: 'string' }, price: { type: 'string' }, narration: { type: 'string' } }, required: ['caption', 'narration'] },
      },
      required: ['hook', 'slots', 'cta'],
    },
  };
  const m = await clientOf().messages.create({
    model: 'claude-sonnet-5', max_tokens: 4000, system: SYS,
    tools: [TOOL], tool_choice: { type: 'tool', name: 'ad_script' },
    messages: [{ role: 'user', content: `팩트:\n${facts}\n\n전체 나레이션 합계 약 165자(30초). ad_script 도구로 출력.` }],
  });
  const block = m.content.find((c) => c.type === 'tool_use') as { input?: unknown } | undefined;
  if (!block?.input) throw new Error('AI 스크립트 생성 실패. 다시 시도해주세요.');
  const j = block.input as {
    hook: { pains: string[]; question: string; scenes?: HookScene[] };
    slots: { caption: string; narration: string }[];
    cta: { caption: string; price?: string; narration: string };
  };
  const slots: DraftSlot[] = [];
  slots.push({ kind: 'hook', lines: (j.hook.pains || []).slice(0, 3), question: j.hook.question, scenes: j.hook.scenes, narration: [...(j.hook.pains || []), j.hook.question].join(', ') });
  for (const s of j.slots || []) slots.push({ kind: 'promo', lines: [s.caption], narration: hangulizeCounters(s.narration || s.caption) });
  slots.push({ kind: 'cta', lines: [j.cta.caption], price: j.cta.price, narration: hangulizeCounters(j.cta.narration || j.cta.caption) });
  return { productName, slots };
}
