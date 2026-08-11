import { supabase } from './supabase';

export type Plan = 'free' | 'lite' | 'pro' | 'business' | 'admin';

// 구독 플랜별 월 영상 한도
export const PLAN_LIMITS: Record<Plan, number> = {
  free: 0,
  lite: 10,
  pro: 30,
  business: 100,
  admin: Infinity,
};

// 테스트 계정 개별 한도 (이메일 기준, 소문자 비교). 실사용자 미영향.
export const CUSTOM_LIMITS: Record<string, number> = {
  'test@shortsai.kr': 10,
};

// 구독 플랜 월 결제금액 (VAT 포함 실청구가)
export const PLAN_PRICES: Record<Plan, number> = {
  free: 0,
  lite: 2000,
  pro: 4000,
  business: 10000,
  admin: 0,
};

// LemonSqueezy variant ID → Plan 매핑 (레거시, 미사용)
export const VARIANT_TO_PLAN: Record<string, Plan> = {
  '1409976': 'pro',
  '1410086': 'business',
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
 * Check if user can generate another video.
 * 구독/무료 월 한도가 남았거나, 크레딧 잔액이 있으면 생성 가능.
 */
export async function canGenerate(userId: string): Promise<boolean> {
  const usage = await getUsage(userId);
  return usage.remaining > 0 || usage.credits > 0;
}

/**
 * Increment usage.
 * 구독/무료 월 한도가 남으면 월 사용량 +1, 소진됐으면 크레딧 -1.
 */
export async function incrementUsage(userId: string): Promise<void> {
  const currentMonth = getCurrentMonth();
  const usage = await getUsage(userId);

  if (usage.remaining > 0) {
    await supabase.rpc('increment_usage', { user_id_param: userId, current_month: currentMonth });
    return;
  }

  // 월 한도 소진 → 크레딧 1 차감 (남아있을 때만)
  const { data } = await supabase.from('users').select('credits').eq('id', userId).single();
  const credits = (data?.credits as number) || 0;
  if (credits > 0) {
    await supabase.from('users').update({ credits: credits - 1 }).eq('id', userId);
  }
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
}

/**
 * 정기결제 갱신 — 월 자동청구 크론에서 청구 성공 후 호출.
 * 만료일을 (현재 만료일 또는 지금 중 큰 값)에서 +1개월 연장.
 */
export async function renewSubscription(userId: string, currentExpiresAt: string | null): Promise<void> {
  const base = currentExpiresAt && new Date(currentExpiresAt) > new Date()
    ? new Date(currentExpiresAt)
    : new Date();
  base.setMonth(base.getMonth() + 1);
  await supabase
    .from('users')
    .update({ plan_expires_at: base.toISOString() })
    .eq('id', userId);
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
