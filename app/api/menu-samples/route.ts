import { NextResponse } from 'next/server';
import { readMenuSamples } from '@/lib/menuSamples';

export const dynamic = 'force-dynamic';

// 공개: 스튜디오 메뉴별 대표 샘플(영상/로고 이미지). 랜딩·스튜디오 페이지에서 사용.
export async function GET() {
  const s = readMenuSamples();
  return NextResponse.json(s);
}
