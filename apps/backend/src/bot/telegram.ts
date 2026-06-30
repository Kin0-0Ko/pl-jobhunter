import { Telegraf } from 'telegraf';
import pino from 'pino';
import { getPool } from '../config/database.js';
import * as etlState from '../scheduler/etl-state.js';
import type { ETLRunSummary } from '../scheduler/etl-state.js';

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

function formatDigestHtml(summary: ETLRunSummary, header: string): string {
  const ts = summary.completedAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const fallbackLine = summary.fallback > 0 ? ` | ⚠ Fallback: ${summary.fallback}` : '';
  const statsLine = `📥 Fetched: ${summary.rawTotal} | Filtered: ${summary.filtered} | New: ${summary.inserted} | Scored: ${summary.scored}${fallbackLine}`;

  let jobsBlock: string;
  if (summary.inserted > 0 && summary.topJobs.length > 0) {
    const jobLines = summary.topJobs.map((j, i) => {
      const lines = [`${i + 1}. <b>${escHtml(j.title)}</b> @ ${escHtml(j.company)}`];
      if (j.salaryDisplay) lines.push(`   💰 ${escHtml(j.salaryDisplay)} · ⭐ ${j.score}`);
      else lines.push(`   ⭐ ${j.score}`);
      if (j.stack.length > 0) lines.push(`   🛠 ${j.stack.map(escHtml).join(', ')}`);
      return lines.join('\n');
    });
    jobsBlock = `🔥 <b>Top New Jobs</b>\n${jobLines.join('\n\n')}`;
  } else {
    jobsBlock = 'ℹ️ No new jobs this run.';
  }

  return `📊 <b>${escHtml(header)}</b>\n🕐 ${ts}\n${statsLine}\n\n${jobsBlock}`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendRunDigest(summary: ETLRunSummary): Promise<void> {
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) {
    logger.warn('TELEGRAM_ADMIN_CHAT_ID not set — skipping run digest');
    return;
  }
  try {
    await getBot().telegram.sendMessage(chatId, formatDigestHtml(summary, 'ETL Run Complete'), { parse_mode: 'HTML' });
  } catch (err) {
    logger.error({ err }, 'telegram: failed to send run digest');
    throw err;
  }
}

export async function sendCriticalAlert(source: string, err: Error): Promise<void> {
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) {
    logger.warn('TELEGRAM_ADMIN_CHAT_ID not set — skipping critical alert');
    return;
  }
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const msg = `🚨 <b>ETL Run Failed</b>\n🕐 ${ts}\nSource: ${escHtml(source)}\nError: ${escHtml(err.message.slice(0, 200))}`;
  try {
    await getBot().telegram.sendMessage(chatId, msg, { parse_mode: 'HTML' });
  } catch (dispatchErr) {
    logger.error({ err: dispatchErr }, 'telegram: failed to send critical alert');
  }
}

export async function sendOllamaWarning(jobId: string, err: Error): Promise<void> {
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) return;
  const msg = `⚠️ Ollama scoring failed\nJob: ${jobId}\nError: ${err.message.slice(0, 200)}`;
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
    const summary = etlState.lastRunSummary;
    if (!summary) {
      await ctx.reply('ℹ️ No ETL run recorded yet.');
      return;
    }

    // Also do a quick DB health ping and append to digest
    let dbOk = true;
    try {
      const pool = await getPool();
      const conn = await pool.getConnection();
      await conn.close();
    } catch {
      dbOk = false;
    }

    const digest = formatDigestHtml(summary, 'Last ETL Run');
    const health = dbOk ? '' : '\n\n⚠️ DB currently unreachable';
    await ctx.reply(digest + health, { parse_mode: 'HTML' });
  });

  b.command('scrape', async (ctx) => {
    if (etlState.isRunning) {
      await ctx.reply('⏳ ETL already running — please wait.');
      return;
    }
    await ctx.reply('⚡ ETL triggered ✅');
    // Lazy import breaks the etl.ts ↔ telegram.ts circular dependency
    const { runEtl } = await import('../scheduler/etl.js');
    runEtl()
      .then(async () => {
        if (etlState.lastRunSummary) await sendRunDigest(etlState.lastRunSummary).catch(() => undefined);
      })
      .catch(async (err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error({ err: error.message }, 'telegram: /scrape ETL failed');
        const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
        if (chatId) {
          const ts = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
          await getBot().telegram.sendMessage(
            chatId,
            `🚨 <b>ETL Run Failed</b>\n🕐 ${ts}\nSource: /scrape\nError: ${escHtml(error.message.slice(0, 200))}`,
            { parse_mode: 'HTML' },
          ).catch(() => undefined);
        }
      });
  });

  b.launch().catch((err) => {
    logger.error({ err }, 'telegram: bot launch failed');
  });

  logger.info('telegram: bot started — /status and /scrape commands active');
}
