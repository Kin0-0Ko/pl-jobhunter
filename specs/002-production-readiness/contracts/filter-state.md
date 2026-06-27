# Contract: Client-Side Filter State

**Type**: Frontend-only — no server persistence. Defined in `useFilter.ts` hook.

---

## FilterState Shape

```typescript
interface FilterState {
  keyword: string;
  contractType: 'b2b' | 'uop' | 'both';
  salaryMin: number | null;
  salaryMax: number | null;
  source: 'justjoin' | 'nofluff' | 'both';
}
```

**Defaults** (show-all state):
```typescript
const DEFAULT_FILTER: FilterState = {
  keyword: '',
  contractType: 'both',
  salaryMin: null,
  salaryMax: null,
  source: 'both',
};
```

---

## useFilter Hook Interface

```typescript
function useFilter(jobs: JobWithAnalysis[]): {
  filters: FilterState;
  setFilters: (patch: Partial<FilterState>) => void;
  clearFilters: () => void;
  filteredJobs: JobWithAnalysis[];
  topSkills: Array<{ skill: string; count: number }>; // top 5, score >= 80
}
```

- `filteredJobs` — memoized; recomputes when `jobs` or `filters` change
- `topSkills` — memoized; aggregated from `filteredJobs` where `match_score >= 80`
- `setFilters` — partial patch (merges with current state); triggers recompute
- `clearFilters` — resets to `DEFAULT_FILTER`

---

## Filter Logic Reference

All filters combine with AND (a job must satisfy every active filter):

| Filter | Active when | Predicate |
|--------|------------|-----------|
| keyword | `keyword !== ''` | `job.title` or any `tech_stack` element contains `keyword` (case-insensitive) |
| contractType `'b2b'` | always when not `'both'` | `job.salary_b2b_min !== null` |
| contractType `'uop'` | always when not `'both'` | `job.salary_uop_min !== null` |
| salaryMin | `salaryMin !== null` | active salary range min ≥ `salaryMin` |
| salaryMax | `salaryMax !== null` | active salary range max ≤ `salaryMax` |
| source | when not `'both'` | `job.source === source` |

**Active salary range** for min/max filter: when `contractType === 'b2b'` → `salary_b2b_*`; when `'uop'` → `salary_uop_*`; when `'both'` → satisfies either range.

---

## AnalyticsWidget Input

```typescript
interface SkillCount {
  skill: string;
  count: number;
}

// Input: topSkills from useFilter (already computed, max 5 items)
// Output: rendered bar/list showing skill name + count
// Empty state: "No high-match jobs yet" when topSkills.length === 0
```
