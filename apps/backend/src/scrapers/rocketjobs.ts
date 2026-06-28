import type { Job, JobStatus } from '@pl-jobhunter/shared';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

interface RJEmploymentType {
  type: string;
  fromPln: number | null;
  toPln: number | null;
}

interface RJOffer {
  guid: string;
  title: string;
  companyName: string;
  slug: string;
  employmentTypes: RJEmploymentType[];
}

interface RJResponse {
  data: RJOffer[];
  meta: { totalPages: number; nextPage: number | null };
}

const MAX_PAGES = 5;

export async function fetchRocketJobs(): Promise<Job[]> {
  try {
    const jobs: Job[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetch(
        `https://api.rocketjobs.pl/v2/user-panel/offers?page=${page}&perPage=100`,
        {
          headers: {
            version: '2',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        },
      );

      if (!res.ok) throw new Error(`RocketJobs API error: ${res.status}`);

      const raw = (await res.json()) as RJResponse;
      const offers = raw.data ?? [];

      for (const offer of offers) {
        try {
          if (!offer.guid || !offer.title || !offer.companyName) continue;

          const b2b = offer.employmentTypes?.find((e) => e.type === 'b2b');
          const uop = offer.employmentTypes?.find((e) => e.type === 'permanent');

          jobs.push({
            id: `rj-${offer.guid}`,
            title: offer.title,
            company: offer.companyName,
            url: `https://rocketjobs.pl/offer/${offer.slug}`,
            source: 'justjoin',
            salary_b2b_min: b2b?.fromPln ?? null,
            salary_b2b_max: b2b?.toPln ?? null,
            salary_uop_min: uop?.fromPln ?? null,
            salary_uop_max: uop?.toPln ?? null,
            currency: 'PLN',
            status: 'NEW' as JobStatus,
            created_at: new Date().toISOString(),
          });
        } catch (err) {
          logger.warn({ err }, 'rocketjobs: skipping record due to error');
        }
      }

      if (!raw.meta?.nextPage) break;
    }

    logger.info({ count: jobs.length }, 'rocketjobs: fetched jobs');
    return jobs;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.warn({ err: error.message }, 'rocketjobs: scraper failed — returning empty array');
    return [];
  }
}
