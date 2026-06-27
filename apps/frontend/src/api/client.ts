import type { JobWithAnalysis, JobStatus } from '@pl-jobhunter/shared';

const API_TOKEN = import.meta.env['VITE_API_TOKEN'] as string;
const BASE_URL = import.meta.env['VITE_API_BASE_URL'] ?? '';

function headers(): HeadersInit {
  return {
    'X-API-TOKEN': API_TOKEN,
    'Content-Type': 'application/json',
  };
}

export async function getJobs(): Promise<JobWithAnalysis[]> {
  const res = await fetch(`${BASE_URL}/api/jobs`, { headers: headers() });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<JobWithAnalysis[]>;
}

export async function patchJobStatus(id: string, status: JobStatus): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/jobs/${id}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
}
