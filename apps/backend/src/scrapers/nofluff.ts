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

const NF_BASE = 'https://nofluffjobs.com/api/search/posting';

export async function fetchNoFluff(): Promise<Job[]> {
  try {
    const jobs: Job[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const url = `${NF_BASE}?salaryCurrency=PLN&salaryPeriod=month`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Origin': 'https://nofluffjobs.com',
          'Referer': 'https://nofluffjobs.com/',
        },
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

    logger.info({ count: jobs.length }, 'nofluff: fetched jobs');
    return jobs;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.warn({ err: error.message }, 'nofluff: scraper failed — returning empty array');
    return [];
  }
}
