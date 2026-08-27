/**
 * 스튜디오 메뉴별 대표 샘플 (관리자 지정)
 *
 * - 영상 메뉴(promo/event/product-vs/product-ai): 완성 영상 1개(jobId + videoUrl) 지정
 * - 로고: 5개 스타일별 샘플 이미지 지정(관리자 업로드)
 *
 * 이 매핑은 ① 각 스튜디오 메뉴 페이지 상단, ② 랜딩 기능 카드 에서 재사용된다.
 * 저장: data/menu_samples.json (git 미추적 → 배포 보존).
 * 로고 이미지도 data/logo-samples/ 에 저장하고 /api/logo-sample/{file} 로 서빙한다
 * (Next 프로덕션은 빌드 후 런타임에 추가된 public 파일을 서빙하지 않으므로 API 경유 필수).
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'menu_samples.json');
export const LOGO_DIR = path.join(DATA_DIR, 'logo-samples');

export const VIDEO_MENUS = [
  { key: 'promo', name: '브랜드 소개 영상', href: '/studio/promo' },
  { key: 'event', name: '이벤트 홍보 영상', href: '/studio/event' },
  { key: 'product-vs', name: '제품 홍보 영상 (캐릭터)', href: '/studio/product-vs' },
  { key: 'product-ai', name: '제품 홍보 영상 (AI배우) ⭐', href: '/studio/product-ai' },
] as const;

export const LOGO_STYLES = [
  { id: 'flat', name: '플랫 일러스트' },
  { id: 'minimal', name: '미니멀/기하학' },
  { id: 'emblem', name: '엠블럼/뱃지' },
  { id: 'mascot', name: '마스코트' },
  { id: 'lettermark', name: '레터마크(이니셜)' },
] as const;

export const VIDEO_MENU_KEYS = VIDEO_MENUS.map((m) => m.key) as readonly string[];
export const LOGO_STYLE_IDS = LOGO_STYLES.map((s) => s.id) as readonly string[];

export interface VideoSample { jobId: string; videoUrl: string; posterUrl: string | null; businessName?: string }
export interface MenuSamples {
  videos: Record<string, VideoSample>;   // menuKey → 영상
  logo: Record<string, string>;          // styleId → 이미지 URL(/logo-samples/xxx.png)
  updatedAt: string | null;
}

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }

export function readMenuSamples(): MenuSamples {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const j = JSON.parse(raw) as Partial<MenuSamples>;
    return { videos: j.videos ?? {}, logo: j.logo ?? {}, updatedAt: j.updatedAt ?? null };
  } catch {
    return { videos: {}, logo: {}, updatedAt: null };
  }
}

function write(s: MenuSamples) {
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify({ ...s, updatedAt: new Date().toISOString() }, null, 2));
}

/** 영상 메뉴에 샘플 지정 (jobId="" 이면 해제). */
export function setMenuVideo(menuKey: string, sample: VideoSample | null): MenuSamples {
  if (!VIDEO_MENU_KEYS.includes(menuKey)) throw new Error('알 수 없는 메뉴');
  const s = readMenuSamples();
  if (!sample || !sample.jobId) delete s.videos[menuKey];
  else s.videos[menuKey] = sample;
  write(s);
  return s;
}

/** 로고 스타일 이미지 지정. imgUrl 은 /logo-samples/... 공개 경로. */
export function setLogoStyle(styleId: string, imgUrl: string | null): MenuSamples {
  if (!LOGO_STYLE_IDS.includes(styleId)) throw new Error('알 수 없는 스타일');
  const s = readMenuSamples();
  if (!imgUrl) delete s.logo[styleId];
  else s.logo[styleId] = imgUrl;
  write(s);
  return s;
}
