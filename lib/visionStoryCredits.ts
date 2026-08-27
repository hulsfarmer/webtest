/**
 * VisionStory 크레딧 원장 (파일 기반)
 *
 * VisionStory는 잔여 크레딧 조회 API가 없다. 대신
 *  1) 관리자가 "기준 잔여"를 한 번 찍어두고 (baseline, baselineAt)
 *  2) 이후 영상 생성마다 실제 소비 크레딧(cost_credit)을 append-only 원장에 기록
 * 하여  remaining = baseline − (baselineAt 이후 소비 합) 으로 추정한다.
 *
 * 저장 위치: process.cwd()/data (git 미추적 → 배포 git pull 에도 보존).
 * 원장은 JSONL(한 줄=한 건)이라 클러스터 2워커가 O_APPEND 로 동시에 써도 안전.
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const BASELINE_FILE = path.join(DATA_DIR, 'visionstory_credit.json');
const USAGE_FILE = path.join(DATA_DIR, 'ai_credit_usage.jsonl');
const SERVICE = 'visionstory';

interface Baseline { baseline: number; baselineAt: string; updatedBy?: string }
interface UsageRow { service: string; credits: number; jobId?: string; at: string }

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readBaseline(): Baseline | null {
  try {
    const raw = fs.readFileSync(BASELINE_FILE, 'utf8');
    const b = JSON.parse(raw) as Baseline;
    if (typeof b.baseline === 'number' && typeof b.baselineAt === 'string') return b;
  } catch { /* 없음/파손 → null */ }
  return null;
}

function readUsage(): UsageRow[] {
  try {
    const raw = fs.readFileSync(USAGE_FILE, 'utf8');
    return raw.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      try { return JSON.parse(l) as UsageRow; } catch { return null; }
    }).filter((r): r is UsageRow => !!r && r.service === SERVICE && typeof r.credits === 'number');
  } catch {
    return [];
  }
}

/** 영상 생성 성공 시 실제 소비 크레딧 기록. 실패해도 잡 흐름을 막지 않는다. */
export function recordVsUsage(credits: number, jobId?: string): void {
  try {
    if (!Number.isFinite(credits) || credits <= 0) return;
    ensureDir();
    const row: UsageRow = { service: SERVICE, credits, jobId, at: new Date().toISOString() };
    fs.appendFileSync(USAGE_FILE, JSON.stringify(row) + '\n');
  } catch (e) {
    console.error('[visionStoryCredits] recordVsUsage 실패:', e instanceof Error ? e.message : e);
  }
}

/** 관리자가 현재 잔여 크레딧을 기준점으로 설정 (충전/보정 시 호출). */
export function setVsBaseline(balance: number, updatedBy?: string): Baseline {
  ensureDir();
  const b: Baseline = { baseline: balance, baselineAt: new Date().toISOString(), updatedBy };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(b, null, 2));
  return b;
}

export interface VsCreditStatus {
  hasBaseline: boolean;
  baseline: number | null;
  baselineAt: string | null;
  remaining: number | null;      // baseline − baselineAt 이후 소비
  usedSinceBaseline: number;
  usedThisMonth: number;
  usedTotal: number;
  lastUsedAt: string | null;
  entries: number;
}

export function getVsCreditStatus(): VsCreditStatus {
  const b = readBaseline();
  const usage = readUsage();
  const monthPrefix = new Date().toISOString().slice(0, 7); // YYYY-MM

  let usedSinceBaseline = 0, usedThisMonth = 0, usedTotal = 0;
  let lastUsedAt: string | null = null;
  for (const u of usage) {
    usedTotal += u.credits;
    if (u.at.slice(0, 7) === monthPrefix) usedThisMonth += u.credits;
    if (b && u.at >= b.baselineAt) usedSinceBaseline += u.credits;
    if (!lastUsedAt || u.at > lastUsedAt) lastUsedAt = u.at;
  }

  const remaining = b ? Math.max(0, +(b.baseline - usedSinceBaseline).toFixed(2)) : null;
  return {
    hasBaseline: !!b,
    baseline: b?.baseline ?? null,
    baselineAt: b?.baselineAt ?? null,
    remaining,
    usedSinceBaseline: +usedSinceBaseline.toFixed(2),
    usedThisMonth: +usedThisMonth.toFixed(2),
    usedTotal: +usedTotal.toFixed(2),
    lastUsedAt,
    entries: usage.length,
  };
}
