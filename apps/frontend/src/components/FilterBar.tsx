import { useRef, useEffect } from 'react';
import type { FilterState } from '../hooks/useFilter.js';

interface FilterBarProps {
  filters: FilterState;
  setFilters: (patch: Partial<FilterState>) => void;
  clearFilters: () => void;
}

export function FilterBar({ filters, setFilters, clearFilters }: FilterBarProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeyword = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setFilters({ keyword: value }), 150);
  };

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const isActive =
    filters.keyword !== '' ||
    filters.contractType !== 'both' ||
    filters.salaryMin !== null ||
    filters.salaryMax !== null ||
    filters.source !== 'both';

  return (
    <div className="bg-white border-b border-gray-200 px-6 py-3 flex flex-wrap items-center gap-4">
      <input
        type="text"
        placeholder="Search keyword…"
        defaultValue={filters.keyword}
        onChange={handleKeyword}
        className="border border-gray-300 rounded px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-500">Contract:</span>
        {(['both', 'b2b', 'uop'] as const).map((c) => (
          <label key={c} className="flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="contractType"
              value={c}
              checked={filters.contractType === c}
              onChange={() => setFilters({ contractType: c })}
            />
            {c === 'both' ? 'All' : c === 'b2b' ? 'B2B' : 'UoP'}
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-500">Salary:</span>
        <input
          type="number"
          placeholder="Min"
          value={filters.salaryMin ?? ''}
          onChange={(e) => setFilters({ salaryMin: e.target.value ? Number(e.target.value) : null })}
          className="border border-gray-300 rounded px-2 py-1 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-gray-400">–</span>
        <input
          type="number"
          placeholder="Max"
          value={filters.salaryMax ?? ''}
          onChange={(e) => setFilters({ salaryMax: e.target.value ? Number(e.target.value) : null })}
          className="border border-gray-300 rounded px-2 py-1 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-gray-400 text-xs">PLN</span>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-500">Source:</span>
        {(['both', 'justjoin', 'nofluff'] as const).map((s) => (
          <label key={s} className="flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="source"
              value={s}
              checked={filters.source === s}
              onChange={() => setFilters({ source: s })}
            />
            {s === 'both' ? 'All' : s === 'justjoin' ? 'JustJoin' : 'NoFluff'}
          </label>
        ))}
      </div>

      {isActive && (
        <button
          onClick={clearFilters}
          className="text-sm text-blue-600 hover:underline ml-auto"
        >
          Clear all filters
        </button>
      )}
    </div>
  );
}
