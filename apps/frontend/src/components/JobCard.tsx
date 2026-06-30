import { useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { JobWithAnalysis } from '@pl-jobhunter/shared';

interface Props {
  job: JobWithAnalysis;
  onOpen?: (job: JobWithAnalysis) => void;
}

function formatSalary(min: number | null, max: number | null, currency: string): string | null {
  if (min == null && max == null) return null;
  const parts = [min, max].filter((v) => v != null);
  return `${parts.join('–')} ${currency}`;
}

function isHourlySalary(min: number | null, currency: string): boolean {
  return min !== null && min < 500 && currency === 'PLN';
}

export function JobCard({ job, onOpen }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: job.id,
  });
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  const b2b = formatSalary(job.salary_b2b_min, job.salary_b2b_max, job.currency);
  const uop = formatSalary(job.salary_uop_min, job.salary_uop_max, job.currency);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="bg-white rounded-lg shadow p-4 mb-3 cursor-grab active:cursor-grabbing border border-gray-200"
      onPointerDown={(e) => { pointerStart.current = { x: e.clientX, y: e.clientY }; }}
      onPointerUp={(e) => {
        if (!pointerStart.current || !onOpen) return;
        const dx = e.clientX - pointerStart.current.x;
        const dy = e.clientY - pointerStart.current.y;
        if (Math.sqrt(dx * dx + dy * dy) < 5) onOpen(job);
        pointerStart.current = null;
      }}
    >
      <div className="flex justify-between items-start mb-1">
        <h3 className="font-semibold text-gray-900 text-sm leading-tight">{job.title}</h3>
        {job.match_score != null && (
          <span className="ml-2 flex-shrink-0 bg-blue-100 text-blue-800 text-xs font-bold px-2 py-0.5 rounded-full">
            {job.match_score}
          </span>
        )}
      </div>

      <p className="text-gray-600 text-sm mb-2">{job.company}</p>

      <span
        className={`inline-block text-xs px-2 py-0.5 rounded-full mb-2 font-medium ${
          job.source === 'justjoin'
            ? 'bg-green-100 text-green-800'
            : 'bg-purple-100 text-purple-800'
        }`}
      >
        {job.source === 'justjoin' ? 'JustJoin' : 'NoFluff'}
      </span>

      {(b2b ?? uop) && (
        <div className="text-xs text-gray-500 mb-2">
          {b2b && (
            <div className="flex items-center gap-1">
              B2B: {b2b}
              {isHourlySalary(job.salary_b2b_min, job.currency) && (
                <span className="bg-amber-100 text-amber-700 px-1 py-0.5 rounded text-[10px] font-medium">⚠ hourly?</span>
              )}
            </div>
          )}
          {uop && (
            <div className="flex items-center gap-1">
              UoP: {uop}
              {isHourlySalary(job.salary_uop_min, job.currency) && (
                <span className="bg-amber-100 text-amber-700 px-1 py-0.5 rounded text-[10px] font-medium">⚠ hourly?</span>
              )}
            </div>
          )}
        </div>
      )}

      {job.summary && (
        <p className="text-xs text-gray-500 mb-2 line-clamp-2">{job.summary}</p>
      )}

      {job.tech_stack && job.tech_stack.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {job.tech_stack.slice(0, 5).map((tech) => (
            <span key={tech} className="text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded font-medium">
              {tech}
            </span>
          ))}
          {job.tech_stack.length > 5 && (
            <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
              +{job.tech_stack.length - 5}
            </span>
          )}
        </div>
      )}

      <a
        href={job.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-blue-600 hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        View offer →
      </a>
    </div>
  );
}
