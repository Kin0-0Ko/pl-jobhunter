import { useEffect } from 'react';
import type { JobWithAnalysis, RawJob } from '@pl-jobhunter/shared';

type ModalJob = JobWithAnalysis | RawJob;

interface Props {
  job: ModalJob;
  onClose: () => void;
}

function formatSalary(min: number | null, max: number | null, currency: string): string | null {
  if (min == null && max == null) return null;
  const parts = [min, max].filter((v) => v != null);
  return `${parts.join('–')} ${currency}`;
}

function hasAnalysis(job: ModalJob): job is JobWithAnalysis {
  return 'match_score' in job;
}

function isHourlySalary(min: number | null, currency: string): boolean {
  return min !== null && min < 500 && currency === 'PLN';
}

export function JobDetailModal({ job, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const b2b = formatSalary(job.salary_b2b_min, job.salary_b2b_max, job.currency);
  const uop = formatSalary(job.salary_uop_min, job.salary_uop_max, job.currency);
  const analysis = hasAnalysis(job) ? job : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex justify-between items-start mb-4">
            <div className="flex-1 min-w-0 pr-4">
              <h2 className="text-lg font-bold text-gray-900 leading-tight">{job.title}</h2>
              <p className="text-gray-600 mt-0.5">{job.company}</p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {analysis?.match_score != null && (
                <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                  analysis.match_score >= 80
                    ? 'bg-green-100 text-green-800'
                    : analysis.match_score >= 50
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {analysis.match_score}%
                </span>
              )}
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold leading-none"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              job.source === 'justjoin' ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-purple-800'
            }`}>
              {job.source}
            </span>
            {b2b && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 flex items-center gap-1">
                B2B: {b2b}
                {isHourlySalary(job.salary_b2b_min, job.currency) && (
                  <span className="bg-amber-100 text-amber-700 px-1 py-0.5 rounded text-[10px] font-medium">⚠ hourly?</span>
                )}
              </span>
            )}
            {uop && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 flex items-center gap-1">
                UoP: {uop}
                {isHourlySalary(job.salary_uop_min, job.currency) && (
                  <span className="bg-amber-100 text-amber-700 px-1 py-0.5 rounded text-[10px] font-medium">⚠ hourly?</span>
                )}
              </span>
            )}
          </div>

          {analysis?.summary && (
            <div className="mb-4 p-3 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-800">{analysis.summary}</p>
            </div>
          )}

          {analysis?.tech_stack && analysis.tech_stack.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Tech Stack</p>
              <div className="flex flex-wrap gap-1.5">
                {analysis.tech_stack.map((tech) => (
                  <span key={tech} className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-medium">
                    {tech}
                  </span>
                ))}
              </div>
            </div>
          )}

          {job.description && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Description</p>
              <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto border border-gray-100 rounded p-3 bg-gray-50">
                {job.description}
              </div>
            </div>
          )}

          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block w-full text-center py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Open job posting →
          </a>
        </div>
      </div>
    </div>
  );
}
