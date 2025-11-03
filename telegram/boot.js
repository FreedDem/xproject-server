import { Telegraf } from 'telegraf';
import TelegramSubscriber from '../models/TelegramSubscriber.js';

const ENABLED = (process.env.TELEGRAM_ENABLE ?? 'true').toLowerCase() !== 'false';
const TOKEN   = process.env.TELEGRAM_BOT_TOKEN;

const MAX_LEN = 4096;

/** Мягко обрезаем слишком длинные сообщения */
function clampText(t = '') {
  return t.length > MAX_LEN ? t.slice(0, MAX_LEN - 10) + '\n…(truncated)' : t;
}

/** Универсальная отправка с ретраем на 429 */
async function sendSafe(bot, chatId, text, extra) {
  const msg = clampText(text);
  try {
    await bot.telegram.sendMessage(chatId, msg, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(extra || {})
    });
  } catch (err) {
    const code = err?.response?.error_code;
    // Рейт-лимит: подождать и повторить
    if (code === 429) {
      const retryAfterSec =
        err?.response?.parameters?.retry_after ||
        err?.parameters?.retry_after ||
        1;
      await new Promise(r => setTimeout(r, retryAfterSec * 1000));
      await bot.telegram.sendMessage(chatId, msg, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(extra || {})
      });
      return;
    }
    throw err;
  }
}

/** сохранить/активировать подписчика */
async function upsertSub(ctx) {
  try {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    await TelegramSubscriber.updateOne(
      { chatId },
      {
        $set: {
          chatId,
          username:  ctx.from?.username,
          firstName: ctx.from?.first_name,
          lastName:  ctx.from?.last_name,
          isActive:  true
        },
        $setOnInsert: { dateSubscribed: new Date() }
      },
      { upsert: true }
    );
  } catch (e) {
    console.error('upsertSub error:', e?.message || e);
  }
}

/** рассылает всем активным подписчикам; no-op, если бот выключен.
 *  Возвращает true при успешной попытке рассылки, false — если бот недоступен. */
export async function notifyAll(text, extra = {}) {
  if (!global.__tgBot || !ENABLED || !TOKEN) return false;

  const subs = await TelegramSubscriber.find({ isActive: true }).lean();
  const results = await Promise.allSettled(
    subs.map(async (s) => {
      try {
        await sendSafe(global.__tgBot, s.chatId, text, extra);
      } catch (err) {
        const code = err?.response?.error_code;
        // 403/400 — пользователя нельзя дёрнуть: деактивируем
        if (code === 403 || code === 400) {
          await TelegramSubscriber.updateOne(
            { chatId: s.chatId },
            { $set: { isActive: false } }
          );
        }
        // Логируем кратко
        console.error(
          'TG send error:',
          err?.response?.description || err.message || err
        );
      }
    })
  );

  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed) console.warn(`Telegram notify: ${failed} failed of ${results.length}`);
  return true;
}

/** инициализируем один раз, кладём notifyAll в app.locals (даже если бот выключен) */
export function initTelegram(app) {
  // Делаем доступным в роутерах: req.app.locals.notifyAll(...), даже если бот отключён.
  app.locals.notifyAll = notifyAll;

  if (!ENABLED || !TOKEN) {
    console.log('ℹ️ Telegram выключен (TELEGRAM_ENABLE=false либо нет TELEGRAM_BOT_TOKEN)');
    return;
  }
  if (global.__tgBotInited) return;
  global.__tgBotInited = true;

  const bot = new Telegraf(TOKEN);
  global.__tgBot = bot;

  bot.start(async (ctx) => {
    await upsertSub(ctx);
    await ctx.reply('Вы подписаны на уведомления ✅\nКоманды: /stop — отписка, /ping — проверка');
  });

  bot.command('stop', async (ctx) => {
    try {
      const chatId = ctx.chat?.id;
      if (chatId) {
        await TelegramSubscriber.updateOne(
          { chatId },
          { $set: { isActive: false } }
        );
      }
      await ctx.reply('Отписал от уведомлений ✅');
    } catch (e) {
      console.error('stop cmd error:', e?.message || e);
    }
  });

  bot.command('ping', (ctx) => ctx.reply('pong'));
  // любой входящий месседж — подписываем/реактивируем
  bot.on('message', upsertSub);

  bot.launch({ dropPendingUpdates: true })
    .then(() => console.log('🤖 Telegram bot запущен (polling)'))
    .catch(e => console.error('Telegram launch error:', e?.response?.description || e.message));

  // аккуратная остановка
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
