export interface TopJobEntry {
  title: string;
  company: string;
  salaryDisplay: string | null;
  score: number;
  stack: string[];
}

export interface ETLRunSummary {
  completedAt: Date;
  rawTotal: number;
  filtered: number;
  inserted: number;
  scored: number;
  fallback: number;
  topJobs: TopJobEntry[];
}

export let isRunning = false;
export let lastRunSummary: ETLRunSummary | null = null;

export function setRunning(v: boolean): void { isRunning = v; }
export function setLastRunSummary(s: ETLRunSummary): void { lastRunSummary = s; }
