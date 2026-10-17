import { timingSafeEqual } from 'node:crypto';
import { readJSONBody, respondJSON } from './index.mjs';

// Telegram calls POST /api/telegram for every update the bot gets (webhook set by scripts/telegram-setup.mjs).
// The bot only explains itself and tells a chat its id, so the school can move leads to another chat:
// add the bot there, send /chatid, put the id into TELEGRAM_CHAT_ID.
const sameSecret = (given, expected) => {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

function chatText(chatId, env) {
  if (String(chatId) === env.TELEGRAM_CHAT_ID?.trim()) {
    return `Сюда приходят заявки с сайта MinMin School.\n\nID этого чата: ${chatId}`;
  }
  return [
    `ID этого чата: ${chatId}`,
    '',
    'Сейчас заявки с сайта приходят в другой чат. Чтобы получать их здесь, этот ID нужно указать в переменной TELEGRAM_CHAT_ID на Vercel.',
  ].join('\n');
}

// Returns the reply as a webhook response (Telegram executes it), or null when the bot stays silent.
export function botReply(update, env = process.env) {
  const joined = update?.my_chat_member;
  if (joined && ['member', 'administrator'].includes(joined.new_chat_member?.status) && joined.chat?.type !== 'private') {
    return { method: 'sendMessage', chat_id: joined.chat.id, text: chatText(joined.chat.id, env) };
  }
  const message = update?.message;
  const command = typeof message?.text === 'string' ? message.text.trim().split(/[\s@]/)[0].toLowerCase() : '';
  if (!message?.chat || !['/start', '/chatid', '/help'].includes(command)) return null;
  const text = message.chat.type === 'private'
    ? 'Я присылаю заявки с сайта MinMin School в закрытый чат школы. Писать мне не нужно.'
    : chatText(message.chat.id, env);
  return { method: 'sendMessage', chat_id: message.chat.id, text };
}

export function createBotWebhook({ env = process.env } = {}) {
  return async (request, response) => {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      respondJSON(response, { status: 405, body: { ok: false } });
      return;
    }
    const secret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
    if (!secret || !sameSecret(request.headers['x-telegram-bot-api-secret-token'], secret)) {
      respondJSON(response, { status: 401, body: { ok: false } });
      return;
    }
    let update;
    try { update = await readJSONBody(request); }
    catch { respondJSON(response, { status: 200, body: {} }); return; } // never make Telegram resend junk
    respondJSON(response, { status: 200, body: botReply(update, env) || {} });
  };
}
