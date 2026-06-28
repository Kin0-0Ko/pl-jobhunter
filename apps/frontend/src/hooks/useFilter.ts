import { useState, useMemo, useCallback } from 'react';
import type { JobWithAnalysis } from '@pl-jobhunter/shared';

export interface FilterState {
  keyword: string;
  contractType: 'b2b' | 'uop' | 'both';
  salaryMin: number | null;
  salaryMax: number | null;
  source: 'justjoin' | 'nofluff' | 'both';
}

const DEFAULT_FILTER: FilterState = {
  keyword: '',
  contractType: 'both',
  salaryMin: null,
  salaryMax: null,
  source: 'both',
};

interface UseFilterResult {
  filters: FilterState;
  setFilters: (patch: Partial<FilterState>) => void;
  clearFilters: () => void;
  filteredJobs: JobWithAnalysis[];
  topSkills: Array<{ skill: string; count: number }>;
}

export function useFilter(jobs: JobWithAnalysis[]): UseFilterResult {
  const [filters, setFiltersState] = useState<FilterState>(DEFAULT_FILTER);

  const setFilters = useCallback((patch: Partial<FilterState>) => {
    setFiltersState((prev) => ({ ...prev, ...patch }));
  }, []);

  const clearFilters = useCallback(() => {
    setFiltersState(DEFAULT_FILTER);
  }, []);

  const filteredJobs = useMemo(() => {
    const kw = filters.keyword.toLowerCase();
    return jobs.filter((job) => {
      if (kw) {
        const inTitle = job.title.toLowerCase().includes(kw);
        const inStack = job.tech_stack?.some((t) => t.toLowerCase().includes(kw)) ?? false;
        if (!inTitle && !inStack) return false;
      }

      if (filters.contractType === 'b2b' && job.salary_b2b_min === null) return false;
      if (filters.contractType === 'uop' && job.salary_uop_min === null) return false;

      if (filters.salaryMin !== null || filters.salaryMax !== null) {
        const getSalaryRange = (): [number | null, number | null] => {
          if (filters.contractType === 'b2b') return [job.salary_b2b_min, job.salary_b2b_max];
          if (filters.contractType === 'uop') return [job.salary_uop_min, job.salary_uop_max];
          const b2bMin = job.salary_b2b_min;
          const uopMin = job.salary_uop_min;
          const b2bMax = job.salary_b2b_max;
          const uopMax = job.salary_uop_max;
          const bestMin = b2bMin !== null && uopMin !== null ? Math.max(b2bMin, uopMin)
            : b2bMin ?? uopMin;
          const bestMax = b2bMax !== null && uopMax !== null ? Math.max(b2bMax, uopMax)
            : b2bMax ?? uopMax;
          return [bestMin, bestMax];
        };

        const [rangeMin, rangeMax] = getSalaryRange();
        if (filters.salaryMin !== null && (rangeMin === null || rangeMin < filters.salaryMin)) return false;
        if (filters.salaryMax !== null && (rangeMax === null || rangeMax > filters.salaryMax)) return false;
      }

      if (filters.source !== 'both' && job.source !== filters.source) return false;

      return true;
    });
  }, [jobs, filters]);

  const topSkills = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of filteredJobs) {
      if ((job.match_score ?? 0) < 80) continue;
      for (const skill of job.tech_stack ?? []) {
        counts.set(skill, (counts.get(skill) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([skill, count]) => ({ skill, count }));
  }, [filteredJobs]);

  return { filters, setFilters, clearFilters, filteredJobs, topSkills };
}
