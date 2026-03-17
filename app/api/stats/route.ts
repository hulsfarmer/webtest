import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const { count, error } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'done');

  if (error) {
    console.error('[Stats] count error:', error.message);
    return NextResponse.json({ totalVideos: 0 });
  }

  return NextResponse.json({ totalVideos: count || 0 });
}
