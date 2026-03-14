import { supabase } from './supabase';

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

// DB row shape
interface JobRow {
  id: string;
  user_id: string;
  status: string;
  progress: number;
  topic: string | null;
  business_name: string | null;
  duration: number | null;
  tone: string | null;
  steps: Record<string, string> | null;
  script: Record<string, unknown> | null;
  video_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    sessionId: row.user_id,
    topic: row.topic || '',
    duration: row.duration || 60,
    tone: row.tone || '친근한',
    status: (row.status || 'queued') as JobStatus,
    progress: row.progress || 0,
    steps: (row.steps as Job['steps']) || { script: 'pending', audio: 'pending', video: 'pending' },
    script: row.script ? JSON.stringify(row.script) : undefined,
    videoUrl: row.video_url || undefined,
    error: row.error || undefined,
    startedAt: new Date(row.created_at).getTime(),
  };
}

export async function createJob(
  data: Pick<Job, 'id' | 'sessionId' | 'topic' | 'duration' | 'tone'>
): Promise<void> {
  const { error } = await supabase
    .from('jobs')
    .insert({
      id: data.id,
      user_id: data.sessionId,
      topic: data.topic,
      duration: data.duration,
      tone: data.tone,
      status: 'queued',
      progress: 0,
      steps: { script: 'pending', audio: 'pending', video: 'pending' },
    });
  if (error) console.error('[JobStore] createJob error:', error.message);
}

export async function getJob(id: string): Promise<Job | undefined> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return undefined;
  return rowToJob(data as JobRow);
}

export function updateJob(id: string, updates: Partial<Job>): void {
  const dbUpdates: Record<string, unknown> = {};

  if (updates.status !== undefined)   dbUpdates.status = updates.status;
  if (updates.progress !== undefined) dbUpdates.progress = updates.progress;
  if (updates.steps !== undefined)    dbUpdates.steps = updates.steps;
  if (updates.error !== undefined)    dbUpdates.error = updates.error;
  if (updates.videoUrl !== undefined) dbUpdates.video_url = updates.videoUrl;

  if (updates.script !== undefined) {
    // script comes as JSON string, store as jsonb
    try {
      dbUpdates.script = JSON.parse(updates.script);
    } catch {
      dbUpdates.script = updates.script;
    }
  }

  dbUpdates.updated_at = new Date().toISOString();

  supabase
    .from('jobs')
    .update(dbUpdates)
    .eq('id', id)
    .then(({ error }) => {
      if (error) console.error(`[JobStore] updateJob(${id}) error:`, error.message);
    });
}
