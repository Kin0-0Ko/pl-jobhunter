import type { Job } from '@pl-jobhunter/shared';

export interface OllamaScoreResult {
  match_score: number;
  summary: string;
  tech_stack: string[];
  why_good: string;
}

function buildPrompt(job: Job, userProfile: string): string {
  return `You are a job-match scorer. Given a user profile and a job posting, return a JSON object with these exact fields:
- match_score: integer 0-100
- summary: one sentence describing the role
- tech_stack: array of technology strings mentioned
- why_good: one sentence on why this matches the user

User profile: ${userProfile}

Job: ${job.title} at ${job.company}
URL: ${job.url}
Source: ${job.source}

Respond ONLY with valid JSON, no markdown.`;
}

async function callOllama(prompt: string): Promise<OllamaScoreResult | null> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
  const model = process.env.OLLAMA_MODEL ?? 'qwen3:5b';

  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, format: 'json', stream: false }),
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);

  const data = (await res.json()) as { response: string };
  const parsed = JSON.parse(data.response) as OllamaScoreResult;

  if (
    typeof parsed.match_score !== 'number' ||
    typeof parsed.summary !== 'string' ||
    !Array.isArray(parsed.tech_stack) ||
    typeof parsed.why_good !== 'string'
  ) {
    throw new Error('Ollama response missing required fields');
  }

  return parsed;
}

export async function scoreJob(job: Job): Promise<OllamaScoreResult | null> {
  const userProfile =
    process.env.OLLAMA_USER_PROFILE ??
    'Senior TypeScript developer interested in remote roles';
  const prompt = buildPrompt(job, userProfile);

  try {
    return await callOllama(prompt);
  } catch (err) {
    console.warn('Ollama first attempt failed, retrying once:', err);
    try {
      return await callOllama(prompt);
    } catch (retryErr) {
      console.error('Ollama retry failed:', retryErr);
      return null;
    }
  }
}
