import { NextRequest, NextResponse } from 'next/server';
import { adminGuard } from '@/lib/admin-guard';
import { getVsCreditStatus, setVsBaseline } from '@/lib/visionStoryCredits';

export const dynamic = 'force-dynamic';

// 구독/유료 AI 서비스별 상태를 관리자에게 보여준다.
// - kind 'balance': 잔여 크레딧을 실시간 조회 가능 (Recraft, ScraperAPI)
// - kind 'usage'  : 잔여는 없고 기간 소비액만 조회 (Hedra)
// - kind 'none'   : 사용량 기반 과금이라 "잔여" 개념/조회 API 자체가 없음 → 콘솔에서 확인
// - kind 'free'   : 무료(레이트리밋만)
// 정직성 원칙: 조회 불가한 항목을 임의 숫자로 채우지 않는다. 링크로만 안내한다.

type Kind = 'balance' | 'usage' | 'none' | 'free';
type Status = 'ok' | 'warn' | 'critical' | 'na' | 'error' | 'missing';

interface ServiceStatus {
  id: string;
  name: string;
  use: string;            // 어디에 쓰이는지
  envKey: string;
  keyConfigured: boolean;
  kind: Kind;
  status: Status;
  remaining: number | null;
  limit: number | null;
  unit: string;           // 단위 표기 (크레딧, 요청 등)
  detail: string;         // 사람이 읽는 상태 문구
  dashboardUrl: string;
  error?: string;
}

function has(key: string): boolean {
  return !!(process.env[key] && process.env[key]!.trim());
}

async function fetchJson(url: string, init: RequestInit, ms = 12000): Promise<{ ok: boolean; status: number; json?: unknown; text?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' });
    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { /* non-json */ }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

// ── Recraft: GET /v1/users/me → { credits } ──────────────────────────────
async function recraftStatus(): Promise<Partial<ServiceStatus>> {
  const token = process.env.RECRAFT_API_TOKEN;
  if (!token) return { keyConfigured: false, status: 'missing', detail: '키 미설정' };
  try {
    const r = await fetchJson('https://external.api.recraft.ai/v1/users/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return { status: 'error', detail: `조회 실패 (HTTP ${r.status})`, error: r.text?.slice(0, 200) };
    const credits = Number((r.json as { credits?: number } | undefined)?.credits ?? NaN);
    if (!Number.isFinite(credits)) return { status: 'error', detail: '응답에 credits 없음' };
    const status: Status = credits < 200 ? 'critical' : credits < 800 ? 'warn' : 'ok';
    return { status, remaining: credits, detail: `잔여 ${credits.toLocaleString()} 크레딧` };
  } catch (e) {
    return { status: 'error', detail: '조회 오류', error: e instanceof Error ? e.message : String(e) };
  }
}

// ── ScraperAPI: GET /account → { creditsLeft, requestCount, requestLimit } ─
async function scraperStatus(): Promise<Partial<ServiceStatus>> {
  const key = process.env.SCRAPER_API_KEY;
  if (!key) return { keyConfigured: false, status: 'missing', detail: '키 미설정' };
  try {
    const r = await fetchJson(`https://api.scraperapi.com/account?api_key=${encodeURIComponent(key)}`, {});
    if (!r.ok) return { status: 'error', detail: `조회 실패 (HTTP ${r.status})`, error: r.text?.slice(0, 200) };
    const d = r.json as { creditsLeft?: number; requestCount?: number; requestLimit?: number; nextBillingDate?: string } | undefined;
    const left = Number(d?.creditsLeft ?? NaN);
    const used = Number(d?.requestCount ?? NaN);
    const limit = Number(d?.requestLimit ?? NaN);
    if (!Number.isFinite(left) && !Number.isFinite(limit)) return { status: 'error', detail: '응답 파싱 실패' };
    const remaining = Number.isFinite(left) ? left : (Number.isFinite(limit) && Number.isFinite(used) ? limit - used : null);
    const ratio = Number.isFinite(limit) && limit > 0 && remaining != null ? remaining / limit : 1;
    const status: Status = ratio < 0.1 ? 'critical' : ratio < 0.25 ? 'warn' : 'ok';
    const billing = d?.nextBillingDate ? ` · 갱신 ${d.nextBillingDate.slice(0, 10)}` : '';
    const usedStr = Number.isFinite(used) && Number.isFinite(limit) ? ` (${used.toLocaleString()}/${limit.toLocaleString()} 사용)` : '';
    return { status, remaining, limit: Number.isFinite(limit) ? limit : null, detail: `잔여 ${remaining?.toLocaleString()} 요청${usedStr}${billing}` };
  } catch (e) {
    return { status: 'error', detail: '조회 오류', error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Hedra: GET /v3/usage → 기간 소비액(잔여 없음) ─────────────────────────
async function hedraStatus(): Promise<Partial<ServiceStatus>> {
  const key = process.env.HEDRA_API_KEY;
  if (!key) return { keyConfigured: false, status: 'missing', detail: '키 미설정' };
  try {
    const r = await fetchJson('https://api.hedra.com/v3/usage', { headers: { Authorization: `Key ${key}` } });
    if (!r.ok) return { status: 'na', detail: `사용량 조회 실패 (HTTP ${r.status}) · 잔여 API 없음` };
    const d = r.json as { total_spent?: number; total_jobs?: number; currency?: string } | undefined;
    const spent = Number(d?.total_spent ?? NaN);
    const cur = d?.currency || 'USD';
    if (!Number.isFinite(spent)) return { status: 'na', detail: '잔여 API 없음 · 대시보드 확인' };
    return { status: 'na', detail: `최근 7일 소비 ${spent} ${cur} · 잔여 크레딧 API 없음(대시보드 확인)` };
  } catch (e) {
    return { status: 'na', detail: '잔여 API 없음 · 대시보드 확인', error: e instanceof Error ? e.message : String(e) };
  }
}

// ── VisionStory: 잔여 API 없음 → 파일 원장 기반 추정(기준 잔여 − 이후 소비) ──
function visionStoryStatus(): Partial<ServiceStatus> {
  const s = getVsCreditStatus();
  if (!s.hasBaseline) {
    return {
      status: 'na',
      detail: `기준 잔여 미설정 · 이번 달 소비 ${s.usedThisMonth} · 아래에서 현재 잔여를 입력하세요`,
    };
  }
  const remaining = s.remaining ?? 0;
  const status: Status = remaining < 20 ? 'critical' : remaining < 60 ? 'warn' : 'ok';
  const anchor = s.baselineAt ? s.baselineAt.slice(0, 10) : '';
  return {
    status,
    remaining,
    limit: s.baseline,
    detail: `추정 잔여 ${remaining} 크레딧 (기준 ${s.baseline}@${anchor} − 이후 소비 ${s.usedSinceBaseline}) · 이번 달 ${s.usedThisMonth}`,
  };
}

export async function GET() {
  const guard = await adminGuard();
  if (guard) return guard;

  // 정적 등록부 — 용도/링크/키명. 잔여 조회 로직은 kind별로 아래에서 붙인다.
  const registry: Omit<ServiceStatus, 'keyConfigured' | 'status' | 'remaining' | 'limit' | 'detail' | 'error'>[] = [
    { id: 'recraft',     name: 'Recraft',        use: '로고 SVG/AI(.ai) 벡터 변환',                     envKey: 'RECRAFT_API_TOKEN', kind: 'balance', unit: '크레딧', dashboardUrl: 'https://www.recraft.ai/profile/api' },
    { id: 'scraperapi',  name: 'ScraperAPI',     use: '제품·업체 정보 링크 스크래핑(불러오기)',            envKey: 'SCRAPER_API_KEY',   kind: 'balance', unit: '요청',   dashboardUrl: 'https://dashboard.scraperapi.com/' },
    { id: 'visionstory', name: 'VisionStory',    use: '제품 소개 영상(캐릭터·AI배우 ⭐)',           envKey: 'VISIONSTORY_API_KEY', kind: 'balance', unit: '크레딧', dashboardUrl: 'https://app.visionstory.ai/' },
    { id: 'hedra',       name: 'Hedra',          use: '말하는 캐릭터(구 엔진)',                          envKey: 'HEDRA_API_KEY',     kind: 'usage',   unit: 'USD',    dashboardUrl: 'https://www.hedra.com/' },
    { id: 'gemini',      name: 'Google Gemini',  use: '홍보 대본·로고/이미지 생성·유튜브 디자인·일부 TTS', envKey: 'GEMINI_API_KEY',    kind: 'none',    unit: '',       dashboardUrl: 'https://aistudio.google.com/app/apikey' },
    { id: 'anthropic',   name: 'Anthropic Claude', use: '홍보 대본/스크립트 생성',                        envKey: 'ANTHROPIC_API_KEY', kind: 'none',    unit: '',       dashboardUrl: 'https://console.anthropic.com/settings/billing' },
    { id: 'openai',      name: 'OpenAI',         use: '대본 재구성·일부 음성 처리',                       envKey: 'OPENAI_API_KEY',    kind: 'none',    unit: '',       dashboardUrl: 'https://platform.openai.com/usage' },
    { id: 'google-tts',  name: 'Google TTS/STT', use: '음성 합성 및 자막 타이밍(STT)',                    envKey: 'GOOGLE_TTS_API_KEY', kind: 'none',   unit: '',       dashboardUrl: 'https://console.cloud.google.com/billing' },
    { id: 'azure',       name: 'Azure Speech',   use: '음성 합성(대체 엔진)',                            envKey: 'AZURE_SPEECH_KEY',  kind: 'none',    unit: '',       dashboardUrl: 'https://portal.azure.com/' },
    { id: 'pexels',      name: 'Pexels',         use: '배경 스톡 영상',                                 envKey: 'PEXELS_API_KEY',    kind: 'free',    unit: '',       dashboardUrl: 'https://www.pexels.com/api/' },
  ];

  const live: Record<string, Promise<Partial<ServiceStatus>>> = {
    recraft: recraftStatus(),
    scraperapi: scraperStatus(),
    hedra: hedraStatus(),
    visionstory: Promise.resolve(visionStoryStatus()),
  };

  const services: ServiceStatus[] = await Promise.all(
    registry.map(async (base) => {
      const keyConfigured = has(base.envKey);
      // 정적(none/free) 기본값
      let dyn: Partial<ServiceStatus> = {};
      if (base.id in live) {
        dyn = await live[base.id];
      } else if (base.kind === 'free') {
        dyn = { status: 'ok', detail: '무료 (레이트리밋만)' };
      } else {
        dyn = { status: 'na', detail: keyConfigured ? '사용량 기반 과금 · 콘솔에서 확인' : '키 미설정' };
      }
      return {
        ...base,
        keyConfigured,
        remaining: dyn.remaining ?? null,
        limit: dyn.limit ?? null,
        status: !keyConfigured ? 'missing' : (dyn.status ?? 'na'),
        detail: !keyConfigured ? '키 미설정' : (dyn.detail ?? ''),
        error: dyn.error,
      } as ServiceStatus;
    })
  );

  return NextResponse.json({ services, fetchedAt: new Date().toISOString() });
}

// VisionStory "기준 잔여" 설정 — 충전했거나 실제 잔여와 어긋날 때 관리자가 현재값을 찍는다.
export async function POST(req: NextRequest) {
  const guard = await adminGuard();
  if (guard) return guard;

  let body: { service?: string; balance?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '잘못된 요청' }, { status: 400 }); }

  if (body.service !== 'visionstory') {
    return NextResponse.json({ error: '지원하지 않는 서비스입니다.' }, { status: 400 });
  }
  const balance = Number(body.balance);
  if (!Number.isFinite(balance) || balance < 0) {
    return NextResponse.json({ error: '잔여 크레딧은 0 이상의 숫자여야 합니다.' }, { status: 400 });
  }

  const saved = setVsBaseline(balance);
  return NextResponse.json({ ok: true, baseline: saved });
}
