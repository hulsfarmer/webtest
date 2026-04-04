export type JobStatus =
  | 'queued'
  | 'generating_script'
  | 'generating_audio'
  | 'generating_video'
  | 'done'
  | 'failed';

export type StepStatus = 'pending' | 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  sessionId: string;
  topic: string;
  duration: number;
  tone: string;
  status: JobStatus;
  progress: number;
  steps: {
    script: StepStatus;
    audio: StepStatus;
    video: StepStatus;
  };
  script?: string;
  videoUrl?: string;
  error?: string;
  startedAt: number;
}

// Use globalThis to persist across HMR module reloads in Next.js dev mode
const g = globalThis as unknown as { __shortsai_jobs?: Map<string, Job> };
if (!g.__shortsai_jobs) g.__shortsai_jobs = new Map<string, Job>();
const jobs = g.__shortsai_jobs;

export function createJob(
  data: Pick<Job, 'id' | 'sessionId' | 'topic' | 'duration' | 'tone'>
): Job {
  const job: Job = {
    ...data,
    status: 'queued',
    progress: 0,
    steps: { script: 'pending', audio: 'pending', video: 'pending' },
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function updateJob(id: string, updates: Partial<Job>): void {
  const job = jobs.get(id);
  if (job) {
    jobs.set(id, { ...job, ...updates });
  }
}
