import type { Job, JobStatus } from '@pl-jobhunter/shared';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

interface NFSalary {
  type: 'b2b' | 'permanent' | string;
  from: number;
  to: number;
  currency: string;
}

interface NFPosting {
  id: string;
  title: string;
  name: string;
  url: string;
  salary: NFSalary | null;
}

interface NFResponse {
  postings: NFPosting[];
  totalPages: number;
}

const NF_API = 'https://nofluffjobs.com/api/search/posting';

export async function fetchNoFluff(): Promise<Job[]> {
  const jobs: Job[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const res = await fetch(NF_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page, pageSize: 100 }),
    });

    if (!res.ok) throw new Error(`NoFluffJobs API error: ${res.status}`);

    const data = (await res.json()) as NFResponse;
    totalPages = data.totalPages ?? 1;

    for (const posting of data.postings ?? []) {
      try {
        if (!posting.id || !posting.title || !posting.name) {
          logger.warn({ posting }, 'nofluff: skipping malformed record');
          continue;
        }

        const salary = posting.salary;
        const isB2B = salary?.type === 'b2b';
        const isUoP = salary?.type === 'permanent';

        jobs.push({
          id: `nf-${posting.id}`,
          title: posting.title,
          company: posting.name,
          url: posting.url ?? `https://nofluffjobs.com/job/${posting.id}`,
          source: 'nofluff',
          salary_b2b_min: isB2B ? (salary?.from ?? null) : null,
          salary_b2b_max: isB2B ? (salary?.to ?? null) : null,
          salary_uop_min: isUoP ? (salary?.from ?? null) : null,
          salary_uop_max: isUoP ? (salary?.to ?? null) : null,
          currency: salary?.currency ?? 'PLN',
          status: 'NEW' as JobStatus,
          created_at: new Date().toISOString(),
        });
      } catch (err) {
        logger.warn({ err }, 'nofluff: skipping record due to error');
      }
    }

    page++;
  }

  return jobs;
}
