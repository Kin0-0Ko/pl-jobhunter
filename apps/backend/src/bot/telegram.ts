import { Telegraf } from 'telegraf';
import pino from 'pino';
import oracledb from 'oracledb';
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
      const lines = [`${i + 1}. <a href="${j.url}">${escHtml(j.title)}</a> @ ${escHtml(j.company)}`];
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
  const extra: { parse_mode: 'HTML'; reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } } = { parse_mode: 'HTML' };
  if (summary.topJobs.length > 0) {
    extra.reply_markup = {
      inline_keyboard: summary.topJobs.map((j, i) => [
        { text: `${i + 1}. ${j.title} @ ${j.company} ⭐${j.score}`, callback_data: `job:${i}` },
      ]),
    };
  }
  try {
    await getBot().telegram.sendMessage(chatId, formatDigestHtml(summary, 'ETL Run Complete'), extra);
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

export async function sendNewJobAlert(job: {
  id: string;
  title: string;
  company: string;
  url: string;
  salaryDisplay: string | null;
  score: number;
  summary: string;
  stack: string[];
}): Promise<void> {
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) return;
  const salaryLine = job.salaryDisplay ? `\n💰 ${escHtml(job.salaryDisplay)}` : '';
  const summaryLine = job.summary ? `\n📝 ${escHtml(job.summary)}` : '';
  const stackLine = job.stack.length > 0 ? `\n🛠 ${job.stack.map(escHtml).join(', ')}` : '';
  const msg =
    `🆕 <b>${escHtml(job.title)}</b> @ ${escHtml(job.company)}\n` +
    `⭐ Score: ${job.score}` +
    salaryLine +
    summaryLine +
    stackLine +
    `\n\n<a href="${job.url}">View posting ↗</a>`;
  try {
    await getBot().telegram.sendMessage(chatId, msg, { parse_mode: 'HTML' });
  } catch (err) {
    logger.warn({ err, job_id: job.id }, 'telegram: failed to send new job alert');
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

async function fetchJobDetail(jobId: string): Promise<{ summary: string; tech_stack: string; match_score: number } | null> {
  try {
    const pool = await getPool();
    const conn = await pool.getConnection();
    try {
      const result = await conn.execute<Record<string, unknown>>(
        `SELECT a.match_score, a.summary, a.tech_stack
         FROM ai_analysis a WHERE a.job_id = :job_id`,
        { job_id: jobId },
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          fetchInfo: { SUMMARY: { type: oracledb.STRING }, TECH_STACK: { type: oracledb.STRING } },
        },
      );
      const row = result.rows?.[0];
      if (!row) return null;
      return {
        match_score: row['MATCH_SCORE'] as number,
        summary: (row['SUMMARY'] as string | null) ?? '',
        tech_stack: (row['TECH_STACK'] as string | null) ?? '[]',
      };
    } finally {
      await conn.close();
    }
  } catch {
    return null;
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

  b.on('callback_query', async (ctx) => {
    const data = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    if (typeof data !== 'string' || !data.startsWith('job:')) {
      await ctx.answerCbQuery();
      return;
    }
    const idx = parseInt(data.slice(4), 10);
    const jobs = etlState.lastRunSummary?.topJobs ?? [];
    const entry = jobs[idx];
    if (!entry) {
      await ctx.answerCbQuery('Job not found');
      return;
    }
    await ctx.answerCbQuery();
    const detail = await fetchJobDetail(entry.id);
    const stack = detail
      ? (() => { try { return JSON.parse(detail.tech_stack) as string[]; } catch { return []; } })()
      : entry.stack;
    const salaryLine = entry.salaryDisplay ? `\n💰 ${escHtml(entry.salaryDisplay)}` : '';
    const summaryLine = detail?.summary ? `\n📝 ${escHtml(detail.summary)}` : '';
    const stackLine = stack.length > 0 ? `\n🛠 ${stack.map(escHtml).join(', ')}` : '';
    const msg =
      `<b>${escHtml(entry.title)}</b> @ ${escHtml(entry.company)}\n` +
      `⭐ Score: ${detail?.match_score ?? entry.score}` +
      salaryLine +
      summaryLine +
      stackLine +
      `\n\n<a href="${entry.url}">View posting ↗</a>`;
    await ctx.reply(msg, { parse_mode: 'HTML' });
  });

  b.launch().catch((err) => {
    logger.error({ err }, 'telegram: bot launch failed');
  });

  logger.info('telegram: bot started — /status and /scrape commands active');
}
