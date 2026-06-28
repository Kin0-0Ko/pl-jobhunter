import type { Job, JobStatus } from '@pl-jobhunter/shared';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

interface JJEmploymentType {
  type: string;
  salary: { from: number; to: number; currency: string } | null;
}

interface JJOffer {
  id: string;
  title: string;
  companyName: string;
  offerUrl?: string;
  employmentTypes: JJEmploymentType[];
}

interface JJResponse {
  data: JJOffer[];
  meta?: { totalPages?: number };
}

export async function fetchJustJoin(): Promise<Job[]> {
  try {
    const res = await fetch('https://justjoin.it/api/offers-with-filters', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({
        page: 1,
        pageSize: 100,
        sortBy: 'newest',
        orderBy: 'DESC',
        with_filters: true,
      }),
    });

    if (!res.ok) throw new Error(`JustJoin API error: ${res.status}`);

    const raw = (await res.json()) as JJResponse | JJOffer[];
    const offers: JJOffer[] = Array.isArray(raw) ? raw : ((raw as JJResponse).data ?? []);

    const jobs: Job[] = [];

    for (const offer of offers) {
      try {
        const id = offer.id;
        const title = offer.title;
        const company = offer.companyName;
        if (!id || !title || !company) {
          logger.warn({ offer }, 'justjoin: skipping malformed record');
          continue;
        }

        const b2b = offer.employmentTypes?.find((e) => e.type === 'b2b');
        const uop = offer.employmentTypes?.find((e) => e.type === 'permanent');
        const currency = b2b?.salary?.currency ?? uop?.salary?.currency ?? 'PLN';

        jobs.push({
          id: `jj-${id}`,
          title,
          company,
          url: offer.offerUrl ?? `https://justjoin.it/offers/${id}`,
          source: 'justjoin',
          salary_b2b_min: b2b?.salary?.from ?? null,
          salary_b2b_max: b2b?.salary?.to ?? null,
          salary_uop_min: uop?.salary?.from ?? null,
          salary_uop_max: uop?.salary?.to ?? null,
          currency,
          status: 'NEW' as JobStatus,
          created_at: new Date().toISOString(),
        });
      } catch (err) {
        logger.warn({ err }, 'justjoin: skipping record due to error');
      }
    }

    logger.info({ count: jobs.length }, 'justjoin: fetched jobs');
    return jobs;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.warn({ err: error.message }, 'justjoin: scraper failed — returning empty array');
    return [];
  }
}
