/**
 * 유튜브 배너+프로필 "세트" 디자이너.
 * Claude가 SVG로 디자인을 직접 설계 → 서버 sharp가 정확한 규격 PNG로 렌더.
 * (AI가 배경을 그리는 기존 방식과 달리, 레이아웃을 결정적으로 설계 → 일관·크리스프·규격완벽)
 */
import Anthropic from '@anthropic-ai/sdk';

const BANNER_W = 2048, BANNER_H = 1152; // 유튜브 채널 배너
const PROFILE_S = 800;                   // 유튜브 프로필(원형 크롭)

export interface BrandInput {
  brandName: string;      // 채널/브랜드 이름
  headline?: string;      // 배너 큰 문구(없으면 브랜드명/태그라인 활용)
  tagline?: string;       // 보조 문구
  colors?: string;        // 선호 색(자유 텍스트)
  vibe?: string;          // 분위기/업종 설명
}

export interface DesignSet {
  style: string;          // 스타일 이름(한국어)
  bannerSvg: string;
  profileSvg: string;
}

// 각 세트에 서로 다른 방향을 심어 3종의 변화를 보장(그때그때 AI가 구체 디자인을 잡음)
const STYLE_SEEDS = [
  '미니멀 & 모던 — 딥한 단색/미묘한 그라데이션 배경, 넉넉한 여백, 얇은 악센트 라인, 절제된 세련미',
  '볼드 & 다이내믹 — 대비 강한 색, 큰 기하학 도형이나 대각선 컬러 블록, 강렬한 타이포',
  '따뜻 & 프렌들리 — 부드러운 그라데이션, 둥근 도형, 친근하고 밝은 분위기',
];

const SAFE = { x: 407, y: 407, w: 1234, h: 338 }; // 배너 안전영역(모든 기기 표시): 가운데 1235x338

function client(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function designPrompt(b: BrandInput, seed: string): string {
  const headline = (b.headline || '').trim() || (b.tagline || '').trim() || b.brandName;
  return `너는 실력 있는 브랜드 디자이너야. 유튜브 채널 "배너 1개 + 프로필 1개"를 **한 세트로 통일감 있게** SVG로 디자인해줘.

[브랜드]
- 이름: ${b.brandName}
- 배너 헤드라인(크게): ${headline}
- 보조 문구: ${(b.tagline || '').trim() || '(없음, 넣지 않아도 됨)'}
- 선호 색: ${(b.colors || '').trim() || '(자유롭게 브랜드에 어울리게)'}
- 분위기/업종: ${(b.vibe || '').trim() || '(자유)'}

[이번 세트의 방향]
${seed}

[배너 규격 — 반드시 지킬 것]
- viewBox="0 0 ${BANNER_W} ${BANNER_H}", width/height 명시
- ⚠️ **모든 글자/로고는 안전영역 안에 배치**: x ${SAFE.x}~${SAFE.x + SAFE.w}, y ${SAFE.y}~${SAFE.y + SAFE.h} (이 밖은 기기에 따라 잘림)
- 헤드라인은 이 영역에서 크고 또렷하게. 배경/장식은 전체(0~2048)에 자유롭게.
- 글자 겹침/삐져나감 금지. 한글 길이에 맞춰 font-size 조절(예: 한글 8자↓ ~120px, 14자↓ ~92px, 20자↓ ~72px).

[프로필 규격 — 반드시 지킬 것]
- viewBox="0 0 ${PROFILE_S} ${PROFILE_S}", 정사각. **유튜브가 원형으로 크롭**하니 핵심(로고/이니셜/브랜드명)은 중앙 원(반지름 ~340) 안에.
- 배너와 같은 색/무드로 통일감 있게. 텍스트는 짧게(브랜드명 또는 이니셜).

[공통 규칙]
- 한글 텍스트는 반드시 font-family="Noto Sans CJK KR, sans-serif" 사용. 굵기는 font-weight로.
- 외부 이미지/폰트 참조 금지(순수 도형·그라데이션·텍스트만). 워터마크 금지.
- 색 대비를 충분히 줘서 글자가 항상 읽히게.
- 세련되고 프로다운 완성도. "AI 티" 나는 조잡함 금지.
- ⚠️ **SVG는 간결하게**: rect·circle·ellipse·line·polygon·linearGradient/radialGradient 같은 단순 요소 위주로 구성하고, 좌표가 긴 복잡한 <path>·필터·패턴은 쓰지 마. 요소 개수는 적게(배너 ~15개 이하), 각 SVG는 1500자 이내로 짧게. 적은 요소로 세련되게.

[출력 형식 — 순수 JSON만, 코드블록/설명 없이]
{"style":"이 세트의 한국어 스타일명(짧게)","bannerSvg":"<svg ...>...</svg>","profileSvg":"<svg ...>...</svg>"}`;
}

/** 스타일 시드 1개로 한 세트(배너+프로필) SVG 생성 */
async function genOne(b: BrandInput, seed: string): Promise<DesignSet | null> {
  try {
    const msg = await client().messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 8000,
      messages: [{ role: 'user', content: designPrompt(b, seed) }],
    });
    if (msg.stop_reason === 'max_tokens') console.warn('[banner-designer] 응답이 max_tokens에서 잘림');
    const block = msg.content.find((x) => x.type === 'text');
    if (!block || block.type !== 'text') return null;
    const raw = block.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const obj = JSON.parse(raw) as DesignSet;
    if (!obj.bannerSvg || !obj.profileSvg) return null;
    return { style: obj.style || '스타일', bannerSvg: obj.bannerSvg, profileSvg: obj.profileSvg };
  } catch (e) {
    console.error('[banner-designer] genOne 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** 브랜드 정보로 3종 세트 생성(병렬). 실패한 세트는 제외. */
export async function generateDesignSets(b: BrandInput): Promise<DesignSet[]> {
  const sets = await Promise.all(STYLE_SEEDS.map((s) => genOne(b, s)));
  return sets.filter((s): s is DesignSet => !!s);
}

/** SVG → PNG 버퍼 (정확한 규격). sharp는 빌드 회피 위해 동적 import. */
export async function renderSvg(svg: string, w: number, h: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  // width/height가 없거나 어긋나도 정확한 규격으로 리사이즈
  return sharp(Buffer.from(svg)).resize(w, h, { fit: 'fill' }).png().toBuffer();
}

export async function renderBanner(svg: string): Promise<Buffer> { return renderSvg(svg, BANNER_W, BANNER_H); }
export async function renderProfile(svg: string): Promise<Buffer> { return renderSvg(svg, PROFILE_S, PROFILE_S); }

export const BANNER_DIMS = { BANNER_W, BANNER_H, PROFILE_S };
