import { spawn } from 'child_process';
import { Telegraf } from 'telegraf';
import type { Job } from '@pl-jobhunter/shared';
import pino from 'pino';
import { getPool } from '../config/database.js';

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

export async function startBot(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.warn('TELEGRAM_BOT_TOKEN not set — bot commands disabled');
    return;
  }

  const b = getBot();

  b.command('status', async (ctx) => {
    let dbStatus = '✅ connected';
    let ollamaStatus = '✅ reachable';

    try {
      const pool = await getPool();
      const conn = await pool.getConnection();
      await conn.close();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      dbStatus = `❌ ${error.message.slice(0, 80)}`;
    }

    try {
      const ollamaBase = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
      const res = await fetch(`${ollamaBase}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) ollamaStatus = `❌ HTTP ${res.status}`;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      ollamaStatus = `❌ ${error.message.slice(0, 80)}`;
    }

    await ctx.reply(
      `📊 System Status\nDB: ${dbStatus}\nOllama: ${ollamaStatus}\nTime: ${new Date().toISOString()}`,
    );
  });

  b.command('scrape', async (ctx) => {
    try {
      const child = spawn('node', ['dist/scheduler/etl.js', '--run-once'], {
        detached: true,
        stdio: 'inherit',
      });
      child.unref();
      await ctx.reply('⚡ ETL started in background. Check back in ~5 minutes.');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ err: error.message }, 'telegram: failed to spawn ETL from /scrape');
      await ctx.reply('❌ Failed to start ETL. Check server logs.');
    }
  });

  b.launch().catch((err) => {
    logger.error({ err }, 'telegram: bot launch failed');
  });

  logger.info('telegram: bot started — /status and /scrape commands active');
}
