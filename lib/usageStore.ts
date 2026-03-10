export type Plan = 'free' | 'basic' | 'pro';

interface UserUsage {
  plan: Plan;
  count: number;
  month: string; // YYYY-MM
}

export const PLAN_LIMITS: Record<Plan, number> = {
  free: 5,
  basic: 30,
  pro: Infinity,
};

export const PLAN_PRICES: Record<Plan, number> = {
  free: 0,
  basic: 19,
  pro: 49,
};

// Use globalThis to persist across HMR module reloads in Next.js dev mode
const g = globalThis as unknown as { __shortsai_usage?: Map<string, UserUsage> };
if (!g.__shortsai_usage) g.__shortsai_usage = new Map<string, UserUsage>();
const usageStore = g.__shortsai_usage;

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function getOrCreate(sessionId: string): UserUsage {
  const currentMonth = getCurrentMonth();
  const existing = usageStore.get(sessionId);

  if (!existing || existing.month !== currentMonth) {
    const fresh: UserUsage = { plan: 'free', count: 0, month: currentMonth };
    usageStore.set(sessionId, fresh);
    return fresh;
  }
  return existing;
}

export function getUsage(sessionId: string): UserUsage & { remaining: number } {
  const usage = getOrCreate(sessionId);
  const limit = PLAN_LIMITS[usage.plan];
  const remaining = limit === Infinity ? 999 : Math.max(0, limit - usage.count);
  return { ...usage, remaining };
}

export function canGenerate(sessionId: string): boolean {
  const usage = getOrCreate(sessionId);
  return usage.count < PLAN_LIMITS[usage.plan];
}

export function incrementUsage(sessionId: string): void {
  const usage = getOrCreate(sessionId);
  usageStore.set(sessionId, { ...usage, count: usage.count + 1 });
}

export function upgradePlan(sessionId: string, plan: Plan): void {
  const usage = getOrCreate(sessionId);
  // Reset count so the new plan's full quota is available immediately
  usageStore.set(sessionId, { ...usage, plan, count: 0 });
}

export function resetUsage(sessionId?: string): void {
  if (sessionId) {
    const usage = getOrCreate(sessionId);
    usageStore.set(sessionId, { ...usage, count: 0 });
  } else {
    usageStore.clear();
  }
}
