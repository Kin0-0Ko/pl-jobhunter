import { Telegraf } from 'telegraf';
import type { Job } from '@pl-jobhunter/shared';

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
    console.warn('[Telegram] TELEGRAM_ADMIN_CHAT_ID not set — skipping alert');
    return;
  }

  const msg = `🎯 ${job.title} @ ${job.company}\nScore: ${score}/100\n${job.url}`;

  try {
    await getBot().telegram.sendMessage(chatId, msg);
  } catch (err) {
    console.error('[Telegram] Failed to send alert:', err);
  }
}
