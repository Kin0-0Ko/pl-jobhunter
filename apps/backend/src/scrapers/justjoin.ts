import type { Job, JobStatus } from '@pl-jobhunter/shared';

interface JJEmploymentType {
  type: string;
  salary: { from: number; to: number; currency: string } | null;
}

interface JJOffer {
  id: string;
  title: string;
  company_name: string;
  offer_url?: string;
  employment_types: JJEmploymentType[];
}

export async function fetchJustJoin(): Promise<Job[]> {
  const res = await fetch('https://justjoin.it/api/offers');
  if (!res.ok) throw new Error(`JustJoin API error: ${res.status}`);

  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) throw new Error('JustJoin: expected array response');

  const jobs: Job[] = [];

  for (const offer of raw as JJOffer[]) {
    try {
      if (!offer.id || !offer.title || !offer.company_name) {
        console.warn('JustJoin: skipping malformed record', offer);
        continue;
      }

      const b2b = offer.employment_types?.find((e) => e.type === 'b2b');
      const uop = offer.employment_types?.find((e) => e.type === 'permanent');
      const currency = b2b?.salary?.currency ?? uop?.salary?.currency ?? 'PLN';

      jobs.push({
        id: `jj-${offer.id}`,
        title: offer.title,
        company: offer.company_name,
        url: offer.offer_url ?? `https://justjoin.it/offers/${offer.id}`,
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
      console.warn('JustJoin: skipping record due to error', err);
    }
  }

  return jobs;
}
