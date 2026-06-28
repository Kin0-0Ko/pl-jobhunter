export type JobStatus = 'NEW' | 'FAVORITE' | 'APPLIED' | 'INTERVIEWING' | 'OFFER' | 'REJECTED' | 'ARCHIVED';

export interface UserProfile {
  skills: string[];
  resume_text: string | null;
  preferred_contract: 'b2b' | 'uop' | 'both';
  search_preferences: string | null;
  updated_at: string;
}

export interface Job {
  id: string;
  title: string;
  company: string;
  url: string;
  source: 'justjoin' | 'nofluff' | 'theprotocol' | 'rocketjobs';
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
