// lib/real-ad-script.ts
// 추출 텍스트 → Claude 로 실사 광고 슬롯 초안(자막+나레이션) 생성.
// 원칙: 팩트만(과장 금지), 나레이션 숫자는 한글 native(TTS 오독 방지), 훅=고민3+의문형.
import Anthropic from '@anthropic-ai/sdk';

export interface DraftSlot {
  kind: 'hook' | 'promo' | 'cta';
  lines: string[];          // hook: 고민 구들 / promo·cta: 자막(1~2줄)
  question?: string;        // hook 펀치라인
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
  '너는 한국 쇼핑 상세페이지 사실만으로 30초 세로 광고 쇼츠 스크립트를 쓰는 카피라이터야. 규칙: ' +
  '(1) 주어진 팩트에 없는 내용/과장 절대 금지. ' +
  '(2) 나레이션의 모든 숫자·수량은 한글로 풀어써(3장->세 장, 3개->세 개, 5종->다섯 가지, 100x70->가로 백 세로 칠십, 15,900원->만 오천구백 원, 30도->삼십 도). ' +
  '(3) 훅은 이 제품이 해결하는 고민 3개(각 6~10자 짧은 구)와 마지막 의문형 질문 한 문장. ' +
  '(4) 자막(lines)은 6~14자로 짧게, 이모지 금지. ' +
  '(5) 오직 JSON만 출력(코드펜스·설명 없이).';

export async function generateAdDraft(productName: string, price: string, texts: string[]): Promise<AdDraft> {
  const facts = [`제품명: ${productName}`, price ? `가격: ${price}` : '', ...texts].filter(Boolean).join('\n');
  const usr =
    `팩트:\n${facts}\n\n출력 JSON 스키마:\n` +
    `{"hook":{"pains":["..","..",".."],"question":"..?"},` +
    `"slots":[{"caption":"..","narration":".."}],` +
    `"cta":{"caption":"..","price":"..","narration":".."}}\n` +
    `slots 는 제품등장 포함 4~5개. 전체 나레이션 합계 약 165자(30초).`;
  const m = await clientOf().messages.create({
    model: 'claude-sonnet-5', max_tokens: 1500, system: SYS, messages: [{ role: 'user', content: usr }],
  });
  let raw = m.content.map((c) => ('text' in c ? c.text : '')).join('').trim();
  raw = raw.replace(/^```json?/i, '').replace(/```$/,'').trim();
  const j = JSON.parse(raw) as {
    hook: { pains: string[]; question: string };
    slots: { caption: string; narration: string }[];
    cta: { caption: string; price?: string; narration: string };
  };
  const slots: DraftSlot[] = [];
  slots.push({ kind: 'hook', lines: (j.hook.pains || []).slice(0, 3), question: j.hook.question, narration: [...(j.hook.pains || []), j.hook.question].join(', ') });
  for (const s of j.slots || []) slots.push({ kind: 'promo', lines: [s.caption], narration: hangulizeCounters(s.narration || s.caption) });
  slots.push({ kind: 'cta', lines: [j.cta.caption], price: j.cta.price, narration: hangulizeCounters(j.cta.narration || j.cta.caption) });
  return { productName, slots };
}
