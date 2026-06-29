import { useState } from 'react';
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { JobStatus, JobWithAnalysis } from '@pl-jobhunter/shared';
import type { UseJobsResult } from '../hooks/useJobs.js';
import { KanbanColumn } from './KanbanColumn.js';
import { JobDetailModal } from './JobDetailModal.js';

const STATUSES: JobStatus[] = ['NEW', 'FAVORITE', 'APPLIED', 'INTERVIEWING', 'OFFER', 'REJECTED', 'ARCHIVED'];

interface Props {
  jobs: UseJobsResult['jobs'];
  updateStatus: UseJobsResult['updateStatus'];
}

export function KanbanBoard({ jobs, updateStatus }: Props) {
  const sensors = useSensors(useSensor(PointerSensor));
  const [selected, setSelected] = useState<JobWithAnalysis | null>(null);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const newStatus = over.id as JobStatus;
    const jobId = active.id as string;
    const job = jobs.find((j) => j.id === jobId);
    if (job && job.status !== newStatus) {
      void updateStatus(jobId, newStatus);
    }
  }

  return (
    <>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 p-6 overflow-x-auto min-h-screen">
          {STATUSES.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              jobs={jobs.filter((j) => j.status === status)}
              onOpen={setSelected}
            />
          ))}
        </div>
      </DndContext>
      {selected && <JobDetailModal job={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
