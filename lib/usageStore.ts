import { supabase } from './supabase';

export type Plan = 'free' | 'pro' | 'business';

export const PLAN_LIMITS: Record<Plan, number> = {
  free: 3,
  pro: 30,
  business: 100,
};

export const PLAN_PRICES: Record<Plan, number> = {
  free: 0,
  pro: 9900,
  business: 29000,
};

// LemonSqueezy variant ID → Plan 매핑
export const VARIANT_TO_PLAN: Record<string, Plan> = {
  '1405743': 'pro',
  '1405749': 'business',
};

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

export interface UsageResult {
  plan: Plan;
  count: number;
  month: string;
  remaining: number;
}

/**
 * Get usage info for a user from DB.
 * Auto-resets count if the month has changed.
 */
export async function getUsage(userId: string): Promise<UsageResult> {
  const currentMonth = getCurrentMonth();

  const { data: user } = await supabase
    .from('users')
    .select('plan, monthly_usage, usage_reset_month')
    .eq('id', userId)
    .single();

  if (!user) {
    return { plan: 'free', count: 0, month: currentMonth, remaining: PLAN_LIMITS.free };
  }

  const plan = (user.plan || 'free') as Plan;
  let count = user.monthly_usage || 0;

  // Auto-reset if month changed
  if (user.usage_reset_month !== currentMonth) {
    count = 0;
    await supabase
      .from('users')
      .update({ monthly_usage: 0, usage_reset_month: currentMonth })
      .eq('id', userId);
  }

  const limit = PLAN_LIMITS[plan];
  const remaining = Math.max(0, limit - count);

  return { plan, count, month: currentMonth, remaining };
}

/**
 * Check if user can generate another video.
 */
export async function canGenerate(userId: string): Promise<boolean> {
  const usage = await getUsage(userId);
  return usage.count < PLAN_LIMITS[usage.plan];
}

/**
 * Increment monthly usage count.
 */
export async function incrementUsage(userId: string): Promise<void> {
  const currentMonth = getCurrentMonth();

  await supabase.rpc('increment_usage', { user_id_param: userId, current_month: currentMonth });
}

/**
 * Upgrade user plan (called from Stripe webhook).
 */
export async function upgradePlan(userId: string, plan: Plan): Promise<void> {
  await supabase
    .from('users')
    .update({ plan, monthly_usage: 0, usage_reset_month: getCurrentMonth() })
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
