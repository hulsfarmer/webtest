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

// 사용자가 고르는 스타일 목록(로고 페이지처럼). id로 선택 → seed로 "레이아웃 구조"까지 지시(색만이 아니라 구조가 다름).
export const STYLES: { id: string; label: string; seed: string }[] = [
  { id: 'left', label: '좌측 미니멀', seed: '레이아웃: 라벨→헤드라인→보조문구를 안전영역 왼쪽(x≈470)에 왼쪽정렬(text-anchor="start")로 세로로 쌓고, 오른쪽·구석은 배경/장식 전용. 무드: 딥한 단색/미묘한 그라데이션, 넉넉한 여백, 얇은 악센트 라인, 절제된 미니멀.' },
  { id: 'center', label: '센터 임팩트', seed: '레이아웃: 헤드라인을 안전영역 가로 중앙(x≈1024)에 text-anchor="middle"로 배치하고, 그 위 라벨·아래 보조문구도 모두 중앙정렬. 좌우 대칭. 배경은 좌우 대칭 그라데이션이나 중앙 포인트/원. 무드: 균형 잡힌 임팩트, 위·아래 대칭 악센트 라인.' },
  { id: 'colorblock', label: '컬러 블록', seed: '레이아웃: 안전영역에 강렬한 단색 컬러 블록(둥근 사각 패널 또는 왼쪽 세로 컬러 밴드)을 깔고 그 위에 텍스트를 얹어 강한 대비를 줘. 텍스트는 블록 안 왼쪽정렬. 무드: 볼드·선명, 브랜드 포인트 컬러 강조.' },
  { id: 'bigtype', label: '빅 타이포', seed: '레이아웃: 헤드라인을 화면을 압도하는 큰 타이포로(단 안전영역·총높이 규칙은 지켜 2줄 이내), 장식은 최소화. 라벨/보조문구는 아주 작게. 왼쪽정렬. 무드: 에디토리얼/매거진, 흑백 또는 딥컬러 + 포인트 한 색, 타이포 중심.' },
  { id: 'split', label: '대각 스플릿', seed: '레이아웃: 배경을 대각선(polygon)으로 둘로 나눠 왼쪽은 어둡게(그 위에 텍스트 왼쪽정렬), 오른쪽은 비비드 컬러 면과 도형. 텍스트는 반드시 어두운 왼쪽의 안전영역 안. 무드: 다이내믹·강한 대비.' },
  { id: 'glass', label: '글래스 카드', seed: '레이아웃: 컬러풀한 그라데이션 배경 위에 반투명(fill-opacity 0.12~0.2, 흰색이나 밝은색) 둥근 카드(rect rx)를 안전영역에 얹고 그 카드 안에 텍스트. 무드: 모던 글래스모피즘, 부드럽고 세련.' },
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
- 배경/장식(그라데이션·도형·패널·패턴)은 캔버스 전체(0~2048)에 자유롭게 — 여기서 스타일 차이를 크게 내.
- ⚠️ **레이아웃은 위 [이번 세트의 방향]을 그대로 따라라** (왼쪽정렬 / 중앙정렬 / 컬러패널 / 대각 스플릿 / 카드 등 스타일마다 구조가 달라야 함). 아래 "안전규칙"은 어떤 레이아웃이든 무조건 지켜.
- ⚠️⚠️ **모든 텍스트(라벨·헤드라인·보조문구)는 안전영역 박스(x ${SAFE.x}~${SAFE.x + SAFE.w}, y ${SAFE.y}~${SAFE.y + SAFE.h}) 안에.** 가로로도 이 박스를 넘지 마 — **중앙정렬**(text-anchor="middle")이면 x≈1024 기준, **왼쪽정렬**(start)이면 x≈470 기준. 텍스트 폭은 안전영역의 **60~78% 이내로 짧게**(AI는 글자폭을 못 재니 문구를 짧게 유지).
- ⚠️ **텍스트 블록 전체(라벨+헤드라인 모든 줄+간격+보조문구) 총 세로높이 ≤ 300px**, 안전영역 세로(y 407~745)의 **가운데**에 배치. 위·아래로 삐져나가면 실패 → 넘칠 것 같으면 헤드라인 font-size 축소.
- 전체적으로 **작게·여백 넉넉히**(고급 미니멀 스케일). 헤드라인 2줄이면 작게: 한글 14자↓ ~58px, 20자↓ ~48px, 8자↓ ~74px. 줄간격 1.25~1.4배.
- 헤드라인↔보조문구 사이 **뚜렷한 간격**(폰트의 0.4~0.6배). 단 위 "총높이 300·안전영역" 최우선.
- 글자 겹침·삐져나감·오버플로 금지. 애매하면 더 작게.

[프로필 규격 — 반드시 지킬 것]
- viewBox="0 0 ${PROFILE_S} ${PROFILE_S}", 정사각. **유튜브가 원형으로 크롭**하니 핵심(로고/이니셜/브랜드명)은 중앙 원(반지름 ~340) 안에.
- 배너와 같은 색/무드로 통일감 있게. 텍스트는 짧게(브랜드명 또는 이니셜).

[공통 규칙]
- 한글 텍스트는 반드시 font-family="Noto Sans CJK KR, sans-serif" 사용. 굵기는 font-weight로.
- 외부 이미지/폰트 참조 금지(순수 도형·그라데이션·텍스트만). 워터마크 금지.
- 색 대비를 충분히 줘서 글자가 항상 읽히게.
- 세련되고 프로다운 완성도. "AI 티" 나는 조잡함 금지.
- ⚠️ **SVG는 간결하게**: rect·circle·ellipse·line·polygon·linearGradient/radialGradient 같은 단순 요소 위주로 구성하고, 좌표가 긴 복잡한 <path>·필터·패턴은 쓰지 마. 요소 개수는 적게(배너 ~15개 이하), 각 SVG는 1500자 이내로 짧게. 적은 요소로 세련되게.

[출력 형식 — 아래 형식 그대로. 설명·코드블록 없이. SVG 안에는 따옴표(") 자유롭게 써도 됨]
STYLE: 이 세트의 한국어 스타일명(짧게)
[BANNER]
<svg ...>...</svg>
[PROFILE]
<svg ...>...</svg>`;
}

/** 스타일 시드 1개로 한 세트(배너+프로필) SVG 생성 */
async function genOne(b: BrandInput, seed: string): Promise<DesignSet | null> {
  try {
    const msg = await client().messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 4000,
      // 사고(thinking) 비활성 — SVG 디자인엔 불필요하고 출력토큰·비용·지연을 크게 줄임(품질 유지 확인).
      // 설치 SDK 타입에 thinking 미포함 → 스프레드 캐스트로 런타임 전달.
      ...({ thinking: { type: 'disabled' } } as Record<string, unknown>),
      messages: [{ role: 'user', content: designPrompt(b, seed) }],
    });
    if (msg.stop_reason === 'max_tokens') console.warn('[banner-designer] 응답이 max_tokens에서 잘림');
    const block = msg.content.find((x) => x.type === 'text');
    if (!block || block.type !== 'text') return null;
    const text = block.text;
    // 구분자 기반 파싱(SVG 속 따옴표에 안전). 각 구획에서 <svg>…</svg>만 정확히 추출.
    const styleM = text.match(/STYLE:\s*(.+)/);
    const svgOf = (section: string): string | null => {
      const m = section.match(/<svg[\s\S]*?<\/svg>/i);
      return m ? m[0] : null;
    };
    const bannerPart = text.split(/\[BANNER\]/i)[1]?.split(/\[PROFILE\]/i)[0] ?? '';
    const profilePart = text.split(/\[PROFILE\]/i)[1] ?? '';
    const bannerSvg = svgOf(bannerPart);
    const profileSvg = svgOf(profilePart);
    if (!bannerSvg || !profileSvg) return null;
    return { style: (styleM?.[1] || '스타일').trim(), bannerSvg, profileSvg };
  } catch (e) {
    console.error('[banner-designer] genOne 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** 고른 스타일 하나로 세트(배너+프로필) 1개 생성. 실패 시 null. */
export async function generateOneSet(b: BrandInput, styleId: string): Promise<DesignSet | null> {
  const seed = (STYLES.find((s) => s.id === styleId) || STYLES[0]).seed;
  return genOne(b, seed);
}

/** 기존 세트(SVG)를 자연어 지시로 수정 → 수정된 SVG 세트 반환. 실패 시 null. */
export async function refineDesignSet(bannerSvg: string, profileSvg: string, instruction: string): Promise<DesignSet | null> {
  const prompt = `아래는 유튜브 채널 "배너 + 프로필" 한 세트의 현재 SVG야. 사용자의 수정 요청을 반영해서 **디자인의 전체 톤·구조는 최대한 유지하면서** 요청한 부분만 바꾼 새 SVG를 만들어줘.

[수정 요청]
${instruction}

[현재 배너 SVG]
${bannerSvg}

[현재 프로필 SVG]
${profileSvg}

[지킬 규칙]
- 배너 viewBox 0 0 ${BANNER_W} ${BANNER_H}, 프로필 viewBox 0 0 ${PROFILE_S} ${PROFILE_S} 유지.
- 배너 텍스트는 안전영역(x 407~1641, y 407~745) 안, 왼쪽정렬 한 블록, 전체 높이 ≤300px로 세로 중앙. 헤드라인↔보조문구 간격 넉넉히. 오른쪽·구석은 배경/장식 전용.
- 한글은 font-family="Noto Sans CJK KR, sans-serif". 외부참조·복잡한 path·필터 금지, 간결하게.
- 배너와 프로필은 같은 색/무드로 통일.

[출력 형식 — 아래 형식 그대로. 설명·코드블록 없이. SVG 안에는 따옴표(") 자유]
STYLE: 수정된 세트의 한국어 스타일명(짧게)
[BANNER]
<svg ...>...</svg>
[PROFILE]
<svg ...>...</svg>`;
  try {
    const msg = await client().messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 4000,
      ...({ thinking: { type: 'disabled' } } as Record<string, unknown>),
      messages: [{ role: 'user', content: prompt }],
    });
    const block = msg.content.find((x) => x.type === 'text');
    if (!block || block.type !== 'text') return null;
    const text = block.text;
    const styleM = text.match(/STYLE:\s*(.+)/);
    const svgOf = (section: string): string | null => { const m = section.match(/<svg[\s\S]*?<\/svg>/i); return m ? m[0] : null; };
    const nb = svgOf(text.split(/\[BANNER\]/i)[1]?.split(/\[PROFILE\]/i)[0] ?? '');
    const np = svgOf(text.split(/\[PROFILE\]/i)[1] ?? '');
    if (!nb || !np) return null;
    return { style: (styleM?.[1] || '수정본').trim(), bannerSvg: nb, profileSvg: np };
  } catch (e) {
    console.error('[banner-designer] refine 실패:', e instanceof Error ? e.message : e);
    return null;
  }
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
