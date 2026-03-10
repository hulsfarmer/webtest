// ── 클라이언트/서버 공용 BGM 카탈로그 (Node.js 모듈 없음) ────────────────────

export type BgmId = 'cafe' | 'professional' | 'energetic' | 'warm' | 'trendy' | 'calm' | 'none';

export interface BgmTrack {
  id: BgmId;
  label: string;
  emoji: string;
  desc: string;
  url: string;
  filename: string;
}

export const BGM_CATALOG: BgmTrack[] = [
  {
    id: 'cafe',
    label: '카페 감성',
    emoji: '☕',
    desc: '어쿠스틱 · 편안한',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    filename: 'bgm_cafe.mp3',
  },
  {
    id: 'professional',
    label: '전문 비즈니스',
    emoji: '💼',
    desc: '깔끔한 · 신뢰감',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    filename: 'bgm_professional.mp3',
  },
  {
    id: 'energetic',
    label: '활기찬',
    emoji: '⚡',
    desc: '업비트 · 파워풀',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    filename: 'bgm_energetic.mp3',
  },
  {
    id: 'warm',
    label: '따뜻한',
    emoji: '💕',
    desc: '소프트 · 감성적',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3',
    filename: 'bgm_warm.mp3',
  },
  {
    id: 'trendy',
    label: '트렌디',
    emoji: '👗',
    desc: '팝 · 세련된',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3',
    filename: 'bgm_trendy.mp3',
  },
  {
    id: 'calm',
    label: '차분한',
    emoji: '🌿',
    desc: '앰비언트 · 힐링',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
    filename: 'bgm_calm.mp3',
  },
  {
    id: 'none',
    label: '없음',
    emoji: '🔇',
    desc: '배경음악 없음',
    url: '',
    filename: '',
  },
];

// ── 자동 추천 룰 ──────────────────────────────────────────────────────────────
const BGM_RULES: Array<{
  businessType: string;
  toneMap: Partial<Record<string, BgmId>>;
  default: BgmId;
}> = [
  { businessType: '카페 · 커피숍',      toneMap: { '긴급한': 'energetic', '전문적인': 'professional' }, default: 'cafe' },
  { businessType: '음식점 · 식당',      toneMap: { '전문적인': 'professional', '긴급한': 'energetic' }, default: 'warm' },
  { businessType: '학원 · 교육',        toneMap: { '긴급한': 'energetic', '따뜻한': 'warm' },           default: 'professional' },
  { businessType: '헬스장 · 피트니스',  toneMap: { '따뜻한': 'warm', '전문적인': 'professional' },       default: 'energetic' },
  { businessType: '병원 · 의원',        toneMap: { '친근한': 'warm', '따뜻한': 'warm' },                default: 'professional' },
  { businessType: '뷰티 · 미용',        toneMap: { '전문적인': 'professional', '긴급한': 'energetic' },  default: 'trendy' },
  { businessType: '쇼핑 · 의류',        toneMap: { '전문적인': 'professional', '따뜻한': 'trendy' },     default: 'trendy' },
  { businessType: '부동산',             toneMap: { '친근한': 'cafe', '따뜻한': 'warm' },                default: 'professional' },
  { businessType: '숙박 · 펜션',        toneMap: { '긴급한': 'energetic', '전문적인': 'professional' },  default: 'calm' },
  { businessType: '기타',               toneMap: { '전문적인': 'professional', '긴급한': 'energetic', '따뜻한': 'warm' }, default: 'cafe' },
];

export function recommendBgm(businessType: string, tone: string): BgmId {
  const rule = BGM_RULES.find((r) => r.businessType === businessType);
  if (!rule) return 'cafe';
  return rule.toneMap[tone] ?? rule.default;
}

export function getBgmTrack(bgmId: BgmId): BgmTrack | undefined {
  return BGM_CATALOG.find((t) => t.id === bgmId);
}
