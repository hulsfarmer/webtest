import { supabase } from './supabase';

export type Plan = 'free' | 'lite' | 'pro' | 'business' | 'admin';

// 구독 플랜별 월 영상 한도 (레거시 — 순수 크레딧 모델에선 미사용, getUsage 표시 호환용)
export const PLAN_LIMITS: Record<Plan, number> = {
  free: 0,
  lite: 10,
  pro: 30,
  business: 100,
  admin: Infinity,
};

// 구독 플랜이 매달 지급하는 크레딧 (이월 누적). 첫 결제·갱신 시 잔액에 addCredits.
export const PLAN_CREDITS: Record<Plan, number> = {
  free: 0,
  lite: 55,
  pro: 110,
  business: 0,
  admin: 0,
};

// 테스트 계정 개별 한도 (이메일 기준, 소문자 비교). 실사용자 미영향.
export const CUSTOM_LIMITS: Record<string, number> = {
  'test@shortsai.kr': 10,
};

// 구독 플랜 월 결제금액 (VAT 포함 실청구가)
// ⚠️ 실제 과금·표시의 진실은 lib/portone.ts(PORTONE_PLAN_AMOUNT)·components/PricingSection.tsx.
//    여기 값은 그와 일치시켜 둔 것(라이트 9,900/프로 19,900, 크레딧당 ~180원).
//    business 는 현재 미판매(portone 결제항목·크레딧 없음).
export const PLAN_PRICES: Record<Plan, number> = {
  free: 0,
  lite: 9900,
  pro: 19900,
  business: 0,
  admin: 0,
};

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

export interface UsageResult {
  plan: Plan;
  count: number;
  month: string;
  remaining: number; // 구독/무료 월 한도 잔여
  credits: number;   // 단건 구매 크레딧 잔액(월 리셋 없음)
}

/**
 * Get usage info for a user from DB.
 * Auto-resets count if the month has changed.
 */
export async function getUsage(userId: string): Promise<UsageResult> {
  const currentMonth = getCurrentMonth();

  // select('*')로 조회 — 컬럼 부재에도 안전(undefined 처리)
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (!user) {
    return { plan: 'free', count: 0, month: currentMonth, remaining: PLAN_LIMITS.free, credits: 0 };
  }

  let plan = (user.plan || 'free') as Plan;

  // 정기결제 만료 체크: plan_expires_at이 지났으면 free로 강등
  if (plan !== 'admin' && plan !== 'free' && user.plan_expires_at) {
    if (new Date(user.plan_expires_at).getTime() < Date.now()) {
      plan = 'free';
      await supabase
        .from('users')
        .update({ plan: 'free', plan_expires_at: null })
        .eq('id', userId);
    }
  }

  let count = user.monthly_usage || 0;

  // Auto-reset if month changed
  if (user.usage_reset_month !== currentMonth) {
    count = 0;
    await supabase
      .from('users')
      .update({ monthly_usage: 0, usage_reset_month: currentMonth })
      .eq('id', userId);
  }

  const limit = CUSTOM_LIMITS[(user.email || '').toLowerCase()] ?? PLAN_LIMITS[plan];
  const remaining = Math.max(0, limit - count);
  const credits = (user.credits as number) || 0;

  return { plan, count, month: currentMonth, remaining, credits };
}

/**
 * 크레딧이 n개 이상 있는지 (관리자는 항상 true).
 */
export async function hasCredits(userId: string, n = 1): Promise<boolean> {
  const usage = await getUsage(userId);
  if (usage.plan === 'admin') return true;
  return usage.credits >= n;
}

/**
 * 크레딧 n개 차감 (관리자는 미차감). 0 밑으로는 안 내려감.
 */
export async function chargeCredits(userId: string, n = 1): Promise<void> {
  const usage = await getUsage(userId);
  if (usage.plan === 'admin' || n <= 0) return;
  const next = Math.max(0, usage.credits - n);
  await supabase.from('users').update({ credits: next }).eq('id', userId);
}

/**
 * (호환) 생성 가능 여부 = 크레딧 n개 이상. 슬라이드쇼 등 1크레딧 상품용.
 */
export async function canGenerate(userId: string, n = 1): Promise<boolean> {
  return hasCredits(userId, n);
}

/**
 * (호환) 사용 차감 = 크레딧 n개 차감. 슬라이드쇼 등 1크레딧 상품용.
 */
export async function incrementUsage(userId: string, n = 1): Promise<void> {
  await chargeCredits(userId, n);
}

/**
 * 단건 크레딧 지급 — 단건 결제(포트원 일반결제) 검증 성공 후 호출.
 */
export async function addCredits(userId: string, amount: number): Promise<void> {
  const { data } = await supabase.from('users').select('credits').eq('id', userId).single();
  const credits = (data?.credits as number) || 0;
  await supabase.from('users').update({ credits: credits + amount }).eq('id', userId);
}

/**
 * Upgrade user plan (구독형 — 만료 없음).
 */
export async function upgradePlan(userId: string, plan: Plan): Promise<void> {
  await supabase
    .from('users')
    .update({ plan, monthly_usage: 0, usage_reset_month: getCurrentMonth() })
    .eq('id', userId);
}

/**
 * 정기결제(PortOne 빌링) 시작 — 첫 결제 성공 후 호출.
 * 플랜 활성화 + 만료일 +1개월 + 빌링키 저장.
 */
export async function startSubscription(userId: string, plan: Plan, billingKey: string): Promise<void> {
  const expires = new Date();
  expires.setMonth(expires.getMonth() + 1);
  await supabase
    .from('users')
    .update({
      plan,
      plan_expires_at: expires.toISOString(),
      portone_billing_key: billingKey,
      monthly_usage: 0,
      usage_reset_month: getCurrentMonth(),
    })
    .eq('id', userId);
  // 첫 결제 시 이번 달 크레딧 지급 (이월 누적)
  if (PLAN_CREDITS[plan]) await addCredits(userId, PLAN_CREDITS[plan]);
}

/**
 * 정기결제 갱신 — 월 자동청구 크론에서 청구 성공 후 호출.
 * 만료일을 (현재 만료일 또는 지금 중 큰 값)에서 +1개월 연장.
 */
export async function renewSubscription(userId: string, currentExpiresAt: string | null, plan?: Plan): Promise<void> {
  const base = currentExpiresAt && new Date(currentExpiresAt) > new Date()
    ? new Date(currentExpiresAt)
    : new Date();
  base.setMonth(base.getMonth() + 1);
  await supabase
    .from('users')
    .update({ plan_expires_at: base.toISOString() })
    .eq('id', userId);
  // 갱신 청구 성공 시 이번 달 크레딧 지급 (이월 누적)
  if (plan && PLAN_CREDITS[plan]) await addCredits(userId, PLAN_CREDITS[plan]);
}

/**
 * 구독 해지 — 빌링키 제거로 다음 청구 중단. 플랜은 만료일까지 유지.
 */
export async function cancelSubscription(userId: string): Promise<void> {
  await supabase
    .from('users')
    .update({ portone_billing_key: null })
    .eq('id', userId);
}

/**
 * Reset usage (dev/admin).
 */
export async function resetUsage(userId?: string): Promise<void> {
  if (userId) {
    await supabase
      .from('users')
      .update({ monthly_usage: 0 })
      .eq('id', userId);
  } else {
    await supabase
      .from('users')
      .update({ monthly_usage: 0 });
  }
}
