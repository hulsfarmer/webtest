/**
 * 인스타그램 연동 (Instagram API with Instagram Login) — 본인 비즈니스/크리에이터 계정에 릴스 발행.
 * 페이스북 페이지 불필요. 인스타 직접 로그인(instagram.com) → 장수명 토큰(~60일) 저장 → graph.instagram.com 로 발행.
 *
 * 사전 준비(사용자):
 *  1) 인스타를 비즈니스/크리에이터 계정으로 전환
 *  2) Meta 앱에 "Instagram" 제품 → "Instagram API with Instagram login" 설정 → Instagram App ID/Secret,
 *     OAuth 리디렉트 URI(https://shortsai.kr/api/social/instagram/callback) 등록
 * 자격증명: INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET (.env.local)
 */
import fs from 'fs';
import path from 'path';

const TOKEN_PATH = path.join(process.cwd(), 'data', 'social', 'instagram.json');
export const IG_REDIRECT_URI = 'https://shortsai.kr/api/social/instagram/callback';
const GRAPH = 'https://graph.instagram.com/v21.0';
// 콘텐츠 발행에 필요한 인스타 로그인 스코프
const SCOPE = 'instagram_business_basic,instagram_business_content_publish';

type TokenFile = { access_token: string; ig_user_id: string; username?: string; saved: number };

/** 동의 화면 URL (인스타 로그인) */
export function getAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID || '',
    redirect_uri: IG_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${p.toString()}`;
}

function save(t: TokenFile): void {
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(t));
}

/** code → 장수명 토큰 + IG 계정 ID/username 저장 */
export async function exchangeCode(code: string): Promise<void> {
  const appId = process.env.INSTAGRAM_APP_ID || '';
  const appSecret = process.env.INSTAGRAM_APP_SECRET || '';

  // 1) code → 단수명 토큰 (+ user_id)
  const t1raw = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: appId, client_secret: appSecret, grant_type: 'authorization_code', redirect_uri: IG_REDIRECT_URI, code,
    }).toString(),
  }).then((r) => r.json()) as { access_token?: string; user_id?: number | string; data?: Array<{ access_token: string; user_id: number | string }>; error_message?: string };
  const short = t1raw.access_token || t1raw.data?.[0]?.access_token;
  if (!short) throw new Error(`token exchange 실패: ${JSON.stringify(t1raw).slice(0, 200)}`);

  // 2) 단수명 → 장수명(~60일)
  const t2 = await fetch(`https://graph.instagram.com/access_token?` + new URLSearchParams({
    grant_type: 'ig_exchange_token', client_secret: appSecret, access_token: short,
  }).toString()).then((r) => r.json()) as { access_token?: string; expires_in?: number };
  const token = t2.access_token || short;

  // 3) 계정 정보(user_id, username)
  const me = await fetch(`${GRAPH}/me?` + new URLSearchParams({ fields: 'user_id,username', access_token: token }).toString())
    .then((r) => r.json()) as { user_id?: string; username?: string };
  const igUserId = String(me.user_id || t1raw.user_id || t1raw.data?.[0]?.user_id || '');
  if (!igUserId) throw new Error('IG 계정 ID를 확인하지 못했습니다.');

  save({ access_token: token, ig_user_id: igUserId, username: me.username, saved: Date.now() });
}

export function isConnected(): boolean {
  try { return !!(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')) as TokenFile).access_token; } catch { return false; }
}

export function getAccount(): { username?: string } | null {
  try { const t = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')) as TokenFile; return { username: t.username }; } catch { return null; }
}

/** 장수명 토큰 반환 — 저장 45일 넘었으면 갱신(ig_refresh_token) 후 저장 */
async function getToken(): Promise<{ token: string; igUserId: string }> {
  const t = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')) as TokenFile;
  const ageDays = (Date.now() - (t.saved || 0)) / 86400000;
  if (ageDays > 45) {
    try {
      const r = await fetch(`https://graph.instagram.com/refresh_access_token?` + new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: t.access_token }).toString())
        .then((r) => r.json()) as { access_token?: string };
      if (r.access_token) { const nt = { ...t, access_token: r.access_token, saved: Date.now() }; save(nt); return { token: nt.access_token, igUserId: nt.ig_user_id }; }
    } catch { /* 갱신 실패 시 기존 토큰으로 시도 */ }
  }
  return { token: t.access_token, igUserId: t.ig_user_id };
}

export interface PublishResult { mediaId: string; permalink: string | null }

/** 릴스 발행: 공개 video_url → 컨테이너 생성 → 처리 대기 → media_publish. */
export async function publishReel(videoUrl: string, caption: string): Promise<PublishResult> {
  const { token, igUserId } = await getToken();

  // 1) 컨테이너 생성 (REELS)
  const create = await fetch(`${GRAPH}/${igUserId}/media`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ media_type: 'REELS', video_url: videoUrl, caption: (caption || '').slice(0, 2200), access_token: token }).toString(),
  }).then((r) => r.json()) as { id?: string; error?: unknown };
  if (!create.id) throw new Error(`컨테이너 생성 실패: ${JSON.stringify(create).slice(0, 200)}`);

  // 2) 인코딩 대기 (최대 ~2분)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const st = await fetch(`${GRAPH}/${create.id}?fields=status_code&access_token=${encodeURIComponent(token)}`).then((r) => r.json()) as { status_code?: string };
    if (st.status_code === 'FINISHED') break;
    if (st.status_code === 'ERROR') throw new Error('인스타 영상 처리 실패(ERROR)');
    if (i === 29) throw new Error('인스타 영상 처리 시간 초과');
  }

  // 3) 발행
  const pub = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: create.id, access_token: token }).toString(),
  }).then((r) => r.json()) as { id?: string; error?: unknown };
  if (!pub.id) throw new Error(`발행 실패: ${JSON.stringify(pub).slice(0, 200)}`);

  let permalink: string | null = null;
  try {
    const p = await fetch(`${GRAPH}/${pub.id}?fields=permalink&access_token=${encodeURIComponent(token)}`).then((r) => r.json()) as { permalink?: string };
    permalink = p.permalink || null;
  } catch { /* 무시 */ }

  return { mediaId: pub.id, permalink };
}
