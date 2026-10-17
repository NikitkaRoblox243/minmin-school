import { contacts, programs } from './data.js';

const text = (value) => typeof value === 'string' ? value.trim() : '';
const singleLine = (value) => text(value).replace(/[\r\n]+/g, ' ');
export const formatLabels = {
  undecided: 'Помогите выбрать',
  individual: 'Индивидуально — 1 ученик',
  pair: 'В паре — 2 ученика',
  group: 'Мини-группа — 3–5 учеников',
};
// Где ученику удобнее, чтобы школа ему написала.
export const channelLabels = { telegram: 'Telegram', whatsapp: 'WhatsApp' };
const channelOf = (input) => (Object.hasOwn(channelLabels, text(input.channel)) ? text(input.channel) : 'telegram');
// Российский номер «8 900 …» в ссылках wa.me и t.me должен начинаться с 7.
const phoneDigits = (contact) => text(contact).replace(/\D/g, '').replace(/^8(\d{10})$/, '7$1');

export function validateLead(input = {}) {
  const lead = input && typeof input === 'object' ? input : {};
  const errors = {};
  const name = text(lead.name);
  const contact = text(lead.contact);
  if (!name) errors.name = 'Укажите, как к вам обращаться.';
  else if (name.length > 100) errors.name = 'Имя должно быть не длиннее 100 символов.';

  const telegram = /^@[A-Za-z0-9_]{5,32}$/.test(contact);
  const digits = contact.replace(/\D/g, '');
  const phone = /^\+?[\d\s().-]+$/.test(contact) && digits.length >= 7 && digits.length <= 15;
  const channel = typeof lead.channel === 'string' ? lead.channel.trim() : lead.channel;
  if (channel !== undefined && channel !== '' && (typeof channel !== 'string' || !Object.hasOwn(channelLabels, channel))) {
    errors.channel = 'Выберите, где с вами связаться: Telegram или WhatsApp.';
  }
  if (channel === 'whatsapp' && !phone) errors.contact = 'Укажите номер WhatsApp с кодом страны, например +7 900 123-45-67.';
  else if (!telegram && !phone) errors.contact = 'Укажите Telegram в формате @username или телефон с кодом страны.';
  if (lead.consent !== true) errors.consent = 'Подтвердите, что готовы передать контакт школе.';
  if (text(lead.goal).length > 1000) errors.goal = 'Расскажите о цели в пределах 1000 символов.';
  if (text(lead.program) && !programs.some((program) => program.id === lead.program)) {
    errors.program = 'Выберите направление из списка.';
  }
  const format = typeof lead.format === 'string' ? lead.format.trim() : lead.format;
  if (format !== undefined && format !== '' && (typeof format !== 'string' || !Object.hasOwn(formatLabels, format))) {
    errors.format = 'Выберите формат из списка.';
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

export function buildTelegramDraft(input = {}) {
  const program = programs.find((item) => item.id === input.program);
  return [
    'Здравствуйте! Хочу записаться на бесплатную первую консультацию в MinMin School.',
    '',
    `Имя: ${singleLine(input.name)}`,
    `Контакт: ${singleLine(input.contact)}`,
    `Направление: ${program?.title || 'Помогите выбрать направление'}`,
    `Формат: ${formatLabels[text(input.format)] || formatLabels.undecided}`,
    `Цель: ${text(input.goal) || 'Обсудим на консультации'}`,
  ].join('\n');
}

// Сообщение, которое бот кладёт в закрытый чат школы.
export function buildLeadMessage(input = {}) {
  const program = programs.find((item) => item.id === input.program);
  const channel = channelOf(input);
  const digits = phoneDigits(input.contact);
  // @username Telegram сам делает ссылкой; для номера даём ссылку на чат, чтобы школа написала в один клик.
  const chatLink = text(input.contact).startsWith('@') ? '' : channel === 'whatsapp' ? `https://wa.me/${digits}` : `https://t.me/+${digits}`;
  return [
    '📩 Новая заявка с сайта',
    '',
    `Имя: ${singleLine(input.name)}`,
    `Связаться: ${channelLabels[channel]}`,
    `Контакт: ${singleLine(input.contact)}`,
    ...(chatLink ? [`Написать: ${chatLink}`] : []),
    `Направление: ${program?.title || 'Помогите выбрать'}`,
    `Формат: ${formatLabels[text(input.format)] || formatLabels.undecided}`,
    `Цель: ${text(input.goal) || '—'}`,
  ].join('\n');
}

export function buildTelegramUrl(input) {
  return `https://t.me/${contacts.telegram}?text=${encodeURIComponent(buildTelegramDraft(input))}`;
}

const whatsappNumber = (number = contacts.whatsapp) => String(number || '').replace(/\D/g, '');
export const whatsappAvailable = (number) => whatsappNumber(number).length >= 10;

// wa.me открывает чат с номером школы и уже набранным текстом; без номера ссылка не строится.
export function buildWhatsAppUrl(input, number) {
  const digits = whatsappNumber(number);
  if (!whatsappAvailable(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(buildTelegramDraft(input))}`;
}

export const messengers = {
  telegram: { label: 'Telegram', buildUrl: buildTelegramUrl },
  whatsapp: { label: 'WhatsApp', buildUrl: buildWhatsAppUrl },
};
