import { useState, useEffect } from 'react';
import type { RawJob } from '@pl-jobhunter/shared';
import { getRawJobs } from '../api/client.js';
import { JobDetailModal } from './JobDetailModal.js';

function formatSalary(min: number | null, max: number | null, currency: string): string | null {
  if (min == null && max == null) return null;
  const parts = [min, max].filter((v) => v != null);
  return `${parts.join('–')} ${currency}`;
}

export function RawJobsPage() {
  const [jobs, setJobs] = useState<RawJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RawJob | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    getRawJobs(200, 0)
      .then(setJobs)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = search.trim()
    ? jobs.filter((j) =>
        j.title.toLowerCase().includes(search.toLowerCase()) ||
        j.company.toLowerCase().includes(search.toLowerCase())
      )
    : jobs;

  return (
    <div className="p-6">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-semibold text-gray-800">Raw Scraped Jobs</h2>
        <span className="text-sm text-gray-500">{filtered.length} / {jobs.length} total</span>
        <input
          type="text"
          placeholder="Search title or company…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 w-64"
        />
      </div>

      {loading && <p className="text-gray-500 text-sm">Loading…</p>}
      {error && <p className="text-red-600 text-sm">Error: {error}</p>}

      {!loading && !error && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Title</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Company</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Source</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Salary</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((job, i) => {
                const b2b = formatSalary(job.salary_b2b_min, job.salary_b2b_max, job.currency);
                const uop = formatSalary(job.salary_uop_min, job.salary_uop_max, job.currency);
                const salary = b2b ?? uop ?? '—';
                const date = new Date(job.created_at).toLocaleDateString('pl-PL');
                return (
                  <tr
                    key={job.id}
                    className={`border-b border-gray-100 cursor-pointer hover:bg-blue-50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                    onClick={() => setSelected(job)}
                  >
                    <td className="px-4 py-2.5 font-medium text-gray-900 max-w-xs truncate">{job.title}</td>
                    <td className="px-4 py-2.5 text-gray-600 max-w-[160px] truncate">{job.company}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        job.source === 'justjoin' ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-purple-800'
                      }`}>
                        {job.source}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{salary}</td>
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{date}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">No jobs found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selected && <JobDetailModal job={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
