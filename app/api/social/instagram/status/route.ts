import { NextResponse } from 'next/server';
import { isConnected, getAccount } from '@/lib/instagram';

/** 연결 여부 + @핸들 */
export async function GET() {
  return NextResponse.json({ connected: isConnected(), account: getAccount() });
}

export const dynamic = 'force-dynamic';
