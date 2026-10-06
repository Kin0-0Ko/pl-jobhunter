export type JobStatus = 'NEW' | 'FAVORITE' | 'APPLIED' | 'INTERVIEWING' | 'OFFER' | 'REJECTED' | 'ARCHIVED';

export interface UserProfile {
  skills: string[];
  resume_text: string | null;
  preferred_contract: 'b2b' | 'uop' | 'both';
  search_preferences: string | null;
  updated_at: string;
  target_seniority?: string[];
  max_experience_years?: number;
}

export interface Job {
  id: string;
  title: string;
  company: string;
  url: string;
  source: 'justjoin' | 'nofluff' | 'theprotocol' | 'rocketjobs';
  description?: string;
  salary_b2b_min: number | null;
  salary_b2b_max: number | null;
  salary_uop_min: number | null;
  salary_uop_max: number | null;
  currency: string;
  status: JobStatus;
  created_at: string;
}

export interface AIAnalysis {
  job_id: string;
  match_score: number;
  summary: string;
  tech_stack: string[];
  why_good: string;
}

export type JobWithAnalysis = Job & {
  match_score: number | null;
  summary: string | null;
  tech_stack: string[] | null;
  why_good: string | null;
};

export interface RawJob {
  id: string;
  title: string;
  company: string;
  url: string;
  source: string;
  description: string | null;
  salary_b2b_min: number | null;
  salary_b2b_max: number | null;
  salary_uop_min: number | null;
  salary_uop_max: number | null;
  currency: string;
  created_at: string;
}

export interface ActivityReportTopMatch {
  id: string;
  title: string;
  company: string;
  match_score: number;
}

export interface ActivityReport {
  period: { from: string; to: string };
  generated_at: string;
  totals: {
    jobs_scraped: number;
    jobs_by_source: Record<string, number>;
    jobs_by_status: Record<JobStatus, number>;
    applied: number;
    interviewing: number;
    offers: number;
    rejected: number;
  };
  ai: {
    avg_match_score: number | null;
    top_matches: ActivityReportTopMatch[];
  };
}
