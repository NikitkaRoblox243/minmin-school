import { programs } from './data.js';

const text = (value) => typeof value === 'string' ? value.trim() : '';
const singleLine = (value) => text(value).replace(/[\r\n]+/g, ' ');
export const formatLabels = {
  undecided: 'Помогите выбрать',
  individual: 'Индивидуально — 1 ученик',
  pair: 'В паре — 2 ученика',
  group: 'Мини-группа — 3–5 учеников',
};

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
  if (!telegram && !phone) errors.contact = 'Укажите Telegram в формате @username или телефон с кодом страны.';
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

export function buildTelegramUrl(input) {
  return `https://t.me/minmin_school?text=${encodeURIComponent(buildTelegramDraft(input))}`;
}
