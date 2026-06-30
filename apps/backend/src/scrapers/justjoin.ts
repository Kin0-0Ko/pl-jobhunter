import type { Job, JobStatus } from '@pl-jobhunter/shared';
import pino from 'pino';

interface JJDetailResponse {
  body?: string;
  requiredSkills?: string[];
  niceToHaveSkills?: string[];
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function fetchJustJoinDetail(slug: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.justjoin.it/v1/offers/${slug}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as JJDetailResponse;
    const html = data.body;
    if (!html) return null;
    const text = stripHtml(html);
    return text.slice(0, 2000) || null;
  } catch {
    return null;
  }
}

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

interface JJEmploymentType {
  type: string;
  fromPln: number | null;
  toPln: number | null;
  currency: string;
}

interface JJOffer {
  guid: string;
  title: string;
  companyName: string;
  slug: string;
  categoryName?: string;
  employmentTypes: JJEmploymentType[];
}

interface JJResponse {
  data: JJOffer[];
  meta: { totalPages: number; nextPage: number | null };
}

const MAX_PAGES = 5;

// JustJoin slug format: company-title-city-CATEGORY[-hash]
// Extract the second-to-last segment (before optional 8-char hex hash)
function slugCategory(slug: string): string {
  const parts = slug.split('-');
  if (parts.length < 2) return '';
  const last = parts[parts.length - 1] ?? '';
  // If last part looks like a hex hash (8 chars, all hex digits), skip it
  const hasHash = /^[0-9a-f]{8}$/i.test(last);
  return hasHash ? (parts[parts.length - 2] ?? '') : last;
}

export async function fetchJustJoin(): Promise<Job[]> {
  try {
    const jobs: Job[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetch(
        `https://api.justjoin.it/v2/user-panel/offers?page=${page}&sortBy=published&orderBy=DESC&perPage=100`,
        {
          headers: {
            version: '2',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        },
      );

      if (!res.ok) throw new Error(`JustJoin API error: ${res.status}`);

      const raw = (await res.json()) as JJResponse;
      const offers = raw.data ?? [];

      for (const offer of offers) {
        try {
          if (!offer.guid || !offer.title || !offer.companyName) continue;

          const b2b = offer.employmentTypes?.find((e) => e.type === 'b2b');
          const uop = offer.employmentTypes?.find((e) => e.type === 'permanent');

          // Include category as description stub so keyword/negative filters see it
          const category = offer.categoryName?.toLowerCase() ?? slugCategory(offer.slug);
          jobs.push({
            id: `jj-${offer.guid}`,
            title: offer.title,
            company: offer.companyName,
            url: `https://justjoin.it/offers/${offer.slug}`,
            source: 'justjoin',
            description: category ? `[category:${category}]` : undefined,
            salary_b2b_min: b2b?.fromPln ?? null,
            salary_b2b_max: b2b?.toPln ?? null,
            salary_uop_min: uop?.fromPln ?? null,
            salary_uop_max: uop?.toPln ?? null,
            currency: 'PLN',
            status: 'NEW' as JobStatus,
            created_at: new Date().toISOString(),
          });
        } catch (err) {
          logger.warn({ err }, 'justjoin: skipping record due to error');
        }
      }

      if (!raw.meta?.nextPage) break;
    }

    logger.info({ count: jobs.length }, 'justjoin: fetched jobs');
    return jobs;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.warn({ err: error.message }, 'justjoin: scraper failed — returning empty array');
    return [];
  }
}
