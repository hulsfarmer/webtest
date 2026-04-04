import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/jobStore';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getJob(jobId);

  if (!job) {
    return NextResponse.json({ error: '잡을 찾을 수 없습니다.' }, { status: 404 });
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    steps: job.steps,
    videoUrl: job.videoUrl,
    script: job.script ? JSON.parse(job.script) : undefined,
    error: job.error,
  });
}
