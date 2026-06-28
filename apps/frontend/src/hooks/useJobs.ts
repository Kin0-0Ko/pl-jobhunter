import { useState, useEffect, useCallback } from 'react';
import type { JobWithAnalysis, JobStatus } from '@pl-jobhunter/shared';
import { getJobs, patchJobStatus } from '../api/client.js';

export interface UseJobsResult {
  jobs: JobWithAnalysis[];
  loading: boolean;
  error: string | null;
  updateStatus: (id: string, status: JobStatus) => Promise<void>;
  refetch: () => void;
}

export function useJobs(): UseJobsResult {
  const [jobs, setJobs] = useState<JobWithAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getJobs()
      .then((data) => { if (!cancelled) setJobs(data); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tick]);

  const refetch = useCallback(() => { setTick((t) => t + 1); }, []);

  const updateStatus = useCallback(async (id: string, status: JobStatus) => {
    const prev = jobs;
    setJobs((current) =>
      current.map((j) => (j.id === id ? { ...j, status } : j)),
    );
    try {
      await patchJobStatus(id, status);
    } catch {
      setJobs(prev);
    }
  }, [jobs]);

  return { jobs, loading, error, updateStatus, refetch };
}
