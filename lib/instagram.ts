/**
 * 인스타그램 연동 (본인 비즈니스 계정에 릴스 발행).
 * Facebook Login(OAuth) → 장수명 페이지 토큰 + IG 비즈니스 계정 ID 를 서버 파일에 저장.
 * 발행: 완성 영상의 공개 URL(/api/video/{id}) → 미디어 컨테이너(REELS) 생성 → 처리 대기 → media_publish.
 *
 * 사전 준비(Meta 쪽, 사용자):
 *  1) 인스타를 비즈니스/크리에이터 계정으로 전환
 *  2) 페이스북 페이지에 그 인스타 연결
 *  3) Meta 개발자 앱 생성 → Instagram Graph API → App ID/Secret, redirect URI 등록
 * 자격증명: META_APP_ID / META_APP_SECRET (.env.local)
 */
import fs from 'fs';
import path from 'path';

const TOKEN_PATH = path.join(process.cwd(), 'data', 'social', 'instagram.json');
export const IG_REDIRECT_URI = 'https://shortsai.kr/api/social/instagram/callback';
const GRAPH = 'https://graph.facebook.com/v21.0';
// 릴스 발행 + 페이지/IG 조회에 필요한 권한
const SCOPE = 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management';

type TokenFile = {
  page_token: string;   // 장수명(만료 없음) 페이지 토큰 — 발행에 사용
  ig_user_id: string;   // IG 비즈니스 계정 ID
  page_id?: string;
  username?: string;    // @핸들 (표시용)
  saved: number;
};

/** 동의 화면 URL */
export function getAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.META_APP_ID || '',
    redirect_uri: IG_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    state,
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${p.toString()}`;
}

function save(t: TokenFile): void {
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(t));
}

/** code → 장수명 페이지 토큰 + IG 계정 ID 저장 */
export async function exchangeCode(code: string): Promise<void> {
  const appId = process.env.META_APP_ID || '';
  const appSecret = process.env.META_APP_SECRET || '';

  // 1) code → 단수명 유저 토큰
  const t1 = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
    client_id: appId, client_secret: appSecret, redirect_uri: IG_REDIRECT_URI, code,
  }).toString()).then((r) => r.json()) as { access_token?: string; error?: unknown };
  if (!t1.access_token) throw new Error(`token exchange 실패: ${JSON.stringify(t1).slice(0, 200)}`);

  // 2) 단수명 → 장수명 유저 토큰 (~60일). 이걸로 얻은 페이지 토큰은 만료 없음.
  const t2 = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
    grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: t1.access_token,
  }).toString()).then((r) => r.json()) as { access_token?: string };
  const userToken = t2.access_token || t1.access_token;

  // 3) 내 페이지들 + 각 페이지에 연결된 IG 비즈니스 계정 조회
  const pages = await fetch(`${GRAPH}/me/accounts?` + new URLSearchParams({
    fields: 'id,name,access_token,instagram_business_account{id,username}',
    access_token: userToken,
  }).toString()).then((r) => r.json()) as { data?: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }>; error?: unknown };

  const page = (pages.data || []).find((p) => p.instagram_business_account?.id);
  if (!page || !page.instagram_business_account) {
    throw new Error('인스타 비즈니스 계정이 연결된 페이스북 페이지를 찾지 못했습니다. 인스타를 비즈니스/크리에이터로 전환하고 페이스북 페이지에 연결했는지 확인해주세요.');
  }
  const ig = page.instagram_business_account;
  save({ page_token: page.access_token, ig_user_id: ig.id, page_id: page.id, username: ig.username, saved: Date.now() });
}

export function isConnected(): boolean {
  try { return !!(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')) as TokenFile).ig_user_id; } catch { return false; }
}

export function getAccount(): { username?: string } | null {
  try { const t = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')) as TokenFile; return { username: t.username }; } catch { return null; }
}

export interface PublishResult { mediaId: string; permalink: string | null }

/**
 * 릴스 발행: 공개 video_url → 컨테이너 생성 → 처리 대기 → media_publish.
 * @returns 발행된 미디어 ID + permalink(있으면)
 */
export async function publishReel(videoUrl: string, caption: string): Promise<PublishResult> {
  const t = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')) as TokenFile;
  const token = t.page_token;
  const igId = t.ig_user_id;

  // 1) 미디어 컨테이너 생성 (REELS)
  const create = await fetch(`${GRAPH}/${igId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ media_type: 'REELS', video_url: videoUrl, caption: (caption || '').slice(0, 2200), access_token: token }).toString(),
  }).then((r) => r.json()) as { id?: string; error?: unknown };
  if (!create.id) throw new Error(`컨테이너 생성 실패: ${JSON.stringify(create).slice(0, 200)}`);

  // 2) 영상 인코딩 대기 (최대 ~2분)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const st = await fetch(`${GRAPH}/${create.id}?fields=status_code&access_token=${encodeURIComponent(token)}`).then((r) => r.json()) as { status_code?: string };
    if (st.status_code === 'FINISHED') break;
    if (st.status_code === 'ERROR') throw new Error('인스타 영상 처리 실패(ERROR)');
    if (i === 29) throw new Error('인스타 영상 처리 시간 초과');
  }

  // 3) 발행
  const pub = await fetch(`${GRAPH}/${igId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: create.id, access_token: token }).toString(),
  }).then((r) => r.json()) as { id?: string; error?: unknown };
  if (!pub.id) throw new Error(`발행 실패: ${JSON.stringify(pub).slice(0, 200)}`);

  // 정확한 릴스 링크(permalink) 조회 — 실패해도 발행은 성공이므로 무시
  let permalink: string | null = null;
  try {
    const p = await fetch(`${GRAPH}/${pub.id}?fields=permalink&access_token=${encodeURIComponent(token)}`).then((r) => r.json()) as { permalink?: string };
    permalink = p.permalink || null;
  } catch { /* 무시 */ }

  return { mediaId: pub.id, permalink };
}
