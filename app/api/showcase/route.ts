import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET: 쇼케이스 승인된 영상 목록 (공개)
export async function GET() {
  const { data, error } = await supabase
    .from('reviews')
    .select('job_id, display_name, business_type, rating')
    .eq('status', 'approved')
    .eq('allow_showcase', true)
    .eq('showcase_approved', true)
    .not('job_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(6);

  if (error || !data || data.length === 0) {
    return NextResponse.json({ videos: [] });
  }

  // job_id로 video_url 조회
  const jobIds = data.map(r => r.job_id).filter(Boolean) as string[];
  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, video_url, business_name')
    .in('id', jobIds)
    .eq('status', 'done')
    .not('video_url', 'is', null);

  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ videos: [] });
  }

  const jobMap = new Map(jobs.map(j => [j.id, j]));

  const videos = data
    .filter(r => r.job_id && jobMap.has(r.job_id))
    .map(r => {
      const job = jobMap.get(r.job_id!)!;
      return {
        videoUrl: job.video_url,
        businessName: job.business_name || r.display_name,
        businessType: r.business_type,
        rating: r.rating,
      };
    })
    .slice(0, 3); // 최대 3개

  return NextResponse.json({ videos });
}
