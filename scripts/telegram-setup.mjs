// Connects the leads bot to the live site. Run once (and again only if the token changes):
//   npm run telegram:setup -- --chat <chat id>
// Asks for the token from @BotFather, stores it in Vercel's production variables (never in the repo),
// points the bot's webhook at /api/telegram, posts a check message into the chat and redeploys the site.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import readline from 'node:readline';

const site = 'https://minmin-school.vercel.app';
const chatArg = process.argv.indexOf('--chat');
const chatId = chatArg > -1 ? process.argv[chatArg + 1]?.trim() : '';
if (!/^-?\d+$/.test(chatId || '')) {
  console.error('Укажите чат: npm run telegram:setup -- --chat -1001234567890');
  process.exit(1);
}

function askHidden(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let shown = false;
  rl._writeToOutput = (chunk) => { if (!shown) { process.stdout.write(chunk); shown = true; } else if (chunk.includes('\n')) process.stdout.write('\n'); else process.stdout.write('•'); };
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

async function telegram(token, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  const payload = await response.json();
  if (payload.ok !== true) throw new Error(`${method}: ${payload.description || response.status}`);
  return payload.result;
}

function vercel(args, input) {
  const result = spawnSync('npx', ['-y', 'vercel@latest', ...args], {
    input, encoding: 'utf8', shell: process.platform === 'win32',
    env: { ...process.env, NODE_OPTIONS: '--dns-result-order=ipv4first' },
  });
  if (result.status !== 0) throw new Error(`vercel ${args[0]} ${args[1] || ''}: ${(result.stderr || result.stdout).trim().split('\n').pop()}`);
}

const token = await askHidden('Вставьте токен бота из @BotFather и нажмите Enter: ');
if (!/^\d+:[\w-]{30,}$/.test(token)) { console.error('Это не похоже на токен бота.'); process.exit(1); }

const bot = await telegram(token, 'getMe');
console.log(`✓ Бот найден: @${bot.username}`);

const secret = randomBytes(24).toString('hex');
for (const [name, value] of [['TELEGRAM_BOT_TOKEN', token], ['TELEGRAM_WEBHOOK_SECRET', secret], ['TELEGRAM_CHAT_ID', chatId]]) {
  vercel(['env', 'add', name, 'production', '--force', ...(name === 'TELEGRAM_CHAT_ID' ? ['--no-sensitive'] : [])], value);
}
console.log('✓ Токен и чат сохранены в переменных Vercel');

await telegram(token, 'setWebhook', {
  url: `${site}/api/telegram`, secret_token: secret, allowed_updates: ['message', 'my_chat_member'], drop_pending_updates: true,
});
await telegram(token, 'setMyCommands', { commands: [{ command: 'chatid', description: 'Показать ID этого чата' }] });
await telegram(token, 'setMyDescription', { description: 'Присылает заявки с сайта MinMin School в закрытый чат школы.' });
console.log('✓ Вебхук бота подключён');

await telegram(token, 'sendMessage', { chat_id: chatId, text: '✅ Бот подключён. Сюда будут приходить заявки с сайта MinMin School.' });
console.log('✓ Проверочное сообщение отправлено в чат');

vercel(['redeploy', 'minmin-school.vercel.app', '--target', 'production']);
console.log(`✓ Сайт пересобран с ботом: ${site}`);
