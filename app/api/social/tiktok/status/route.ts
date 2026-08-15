import { NextResponse } from 'next/server';
import { isConnected } from '@/lib/tiktok';

/** 연결 여부 */
export async function GET() {
  return NextResponse.json({ connected: isConnected() });
}

export const dynamic = 'force-dynamic';
