import { useDroppable } from '@dnd-kit/core';
import type { JobWithAnalysis, JobStatus } from '@pl-jobhunter/shared';
import { JobCard } from './JobCard.js';

const COLUMN_LABELS: Record<JobStatus, string> = {
  NEW: 'New',
  FAVORITE: 'Favorite',
  APPLIED: 'Applied',
  ARCHIVED: 'Archived',
};

interface Props {
  status: JobStatus;
  jobs: JobWithAnalysis[];
}

export function KanbanColumn({ status, jobs }: Props) {
  const { isOver, setNodeRef } = useDroppable({ id: status });

  return (
    <div className="flex flex-col w-72 flex-shrink-0">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-700 uppercase tracking-wide text-sm">
          {COLUMN_LABELS[status]}
        </h2>
        <span className="bg-gray-200 text-gray-600 text-xs font-bold px-2 py-0.5 rounded-full">
          {jobs.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 min-h-24 rounded-lg p-2 transition-colors ${
          isOver ? 'bg-blue-50 border-2 border-blue-300 border-dashed' : 'bg-gray-50'
        }`}
      >
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>
    </div>
  );
}
