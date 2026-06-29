import type { JobWithAnalysis, JobStatus, UserProfile, RawJob } from '@pl-jobhunter/shared';

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

export async function getProfile(): Promise<UserProfile | null> {
  const res = await fetch(`${BASE_URL}/api/profile`, { headers: headers() });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<UserProfile | null>;
}

export async function putProfile(data: Omit<UserProfile, 'updated_at'>): Promise<UserProfile> {
  const res = await fetch(`${BASE_URL}/api/profile`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<UserProfile>;
}

export async function getRawJobs(limit = 100, offset = 0): Promise<RawJob[]> {
  const res = await fetch(`${BASE_URL}/api/raw-jobs?limit=${limit}&offset=${offset}`, { headers: headers() });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<RawJob[]>;
}

export async function triggerEtl(): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/etl/trigger`, {
    method: 'POST',
    headers: { 'X-API-TOKEN': API_TOKEN },
  });
  if (!res.ok) throw new Error(`${res.status}`);
}
