import type { Job } from '@pl-jobhunter/shared';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

export async function fetchTheProtocol(): Promise<Job[]> {
  logger.warn('theprotocol: skipped — Cloudflare protected, no lightweight API available');
  return [];
}
