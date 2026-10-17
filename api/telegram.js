// Vercel function: Telegram webhook for the leads bot (answers /chatid in chats).
import { createBotWebhook } from '../server/telegram-bot.mjs';

export default createBotWebhook();
