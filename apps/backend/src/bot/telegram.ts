import { Telegraf } from 'telegraf';
import type { Job } from '@pl-jobhunter/shared';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

let bot: Telegraf | null = null;

function getBot(): Telegraf {
  if (!bot) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');
    bot = new Telegraf(token);
  }
  return bot;
}

export async function sendJobAlert(job: Job, score: number): Promise<void> {
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) {
    logger.warn('TELEGRAM_ADMIN_CHAT_ID not set — skipping alert');
    return;
  }

  const msg = `🎯 ${job.title} @ ${job.company}\nScore: ${score}/100\n${job.url}`;

  try {
    await getBot().telegram.sendMessage(chatId, msg);
  } catch (err) {
    logger.error({ err }, 'telegram: failed to send job alert');
  }
}

export async function sendCriticalAlert(source: string, err: Error): Promise<void> {
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) {
    logger.warn('TELEGRAM_ADMIN_CHAT_ID not set — skipping critical alert');
    return;
  }

  const msg = `🚨 CRITICAL: ETL Pipeline Failed\nSource: ${source}\nError: ${err.message.slice(0, 200)}\nTime: ${new Date().toISOString()}`;

  try {
    await getBot().telegram.sendMessage(chatId, msg);
  } catch (dispatchErr) {
    logger.error({ err: dispatchErr }, 'telegram: failed to send critical alert');
  }
}

export async function sendOllamaWarning(jobId: string, err: Error): Promise<void> {
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) {
    logger.warn('TELEGRAM_ADMIN_CHAT_ID not set — skipping Ollama warning');
    return;
  }

  const msg = `⚠️ WARNING: Ollama scoring failed\nJob: ${jobId}\nError: ${err.message.slice(0, 200)}\nJob persisted without score`;

  try {
    await getBot().telegram.sendMessage(chatId, msg);
  } catch (dispatchErr) {
    logger.error({ err: dispatchErr }, 'telegram: failed to send Ollama warning');
  }
}
