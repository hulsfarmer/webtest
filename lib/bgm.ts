import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { IncomingMessage } from 'http';

export type BgmId = 'cafe' | 'professional' | 'energetic' | 'warm' | 'trendy' | 'calm' | 'none';

export interface BgmTrack {
  id: BgmId;
  label: string;
  emoji: string;
  desc: string;
  url: string;
  filename: string;
}

// ── BGM 카탈로그 ─────────────────────────────────────────────────────────────
// All tracks from SoundHelix (free for any use, stable URLs)
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

// ── 자동 추천 규칙 ────────────────────────────────────────────────────────────
// [업종] × [톤] → BGM ID
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

// ── 다운로드 헬퍼 (redirect 지원, timeout 30s) ───────────────────────────────
function downloadUrl(url: string, destPath: string, maxRedirects = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    if (maxRedirects === 0) { reject(new Error('Too many redirects')); return; }

    const proto = url.startsWith('https') ? https : http;
    const file  = fs.createWriteStream(destPath);

    const cleanup = (err: Error) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    };

    const req = proto.get(url, (res: IncomingMessage) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        file.close();
        fs.unlink(destPath, () => {});
        const location = res.headers.location;
        if (!location) { reject(new Error('Redirect without Location header')); return; }
        downloadUrl(location, destPath, maxRedirects - 1).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode && res.statusCode !== 200) {
        cleanup(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', cleanup);
    });

    req.on('error', cleanup);
    req.setTimeout(30_000, () => { req.destroy(); cleanup(new Error('Download timeout')); });
  });
}

// ── BGM 경로 해결 (캐시 우선, 없으면 다운로드) ─────────────────────────────
export async function resolveBgmPath(bgmId: BgmId): Promise<string | null> {
  if (bgmId === 'none') return null;

  const track = getBgmTrack(bgmId);
  if (!track?.url) return null;

  const bgmDir   = path.join(process.cwd(), 'data', 'bgm');
  if (!fs.existsSync(bgmDir)) fs.mkdirSync(bgmDir, { recursive: true });

  const localPath = path.join(bgmDir, track.filename);

  // 캐시 유효성 확인 (1 KB 이상이면 유효)
  if (fs.existsSync(localPath)) {
    const stat = fs.statSync(localPath);
    if (stat.size > 1024) {
      console.log(`[BGM] 캐시 사용: ${track.filename}`);
      return localPath;
    }
    fs.unlinkSync(localPath); // 불완전 파일 제거
  }

  console.log(`[BGM] 다운로드 중 "${track.label}": ${track.url}`);
  try {
    await downloadUrl(track.url, localPath);
    const stat = fs.statSync(localPath);
    if (stat.size < 1024) throw new Error('Downloaded file too small');
    console.log(`[BGM] 다운로드 완료: ${track.filename} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
    return localPath;
  } catch (e) {
    console.warn(`[BGM] 다운로드 실패 "${track.id}":`, e);
    try { fs.unlinkSync(localPath); } catch { /* ignore */ }
    return null;
  }
}
