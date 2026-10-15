import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLead, buildTelegramDraft, buildTelegramUrl } from '../src/lead.js';

const lead = {
  name: 'Анна',
  contact: '@anna_school',
  program: 'adults',
  goal: 'Хочу общаться в поездках',
  consent: true,
};

test('blank name is reported next to the name field', () => {
  const result = validateLead({ ...lead, name: '   ' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.name);
});

test('invalid contact is rejected rather than creating an unusable lead', () => {
  for (const contact of ['alice', '@abc', '@ann!a', '123', '+1 1234567890123456']) {
    const result = validateLead({ ...lead, contact });
    assert.equal(result.valid, false, contact);
    assert.ok(result.errors.contact, contact);
  }
});

test('Cyrillic name with an explicit Telegram username is accepted', () => {
  assert.deepEqual(validateLead(lead), { valid: true, errors: {} });
});

test('a formatted international phone number is accepted', () => {
  assert.deepEqual(validateLead({ ...lead, contact: '+7 (999) 123-45-67' }), { valid: true, errors: {} });
});

test('a lead cannot proceed without the Telegram handoff acknowledgment', () => {
  const result = validateLead({ ...lead, consent: false });
  assert.equal(result.valid, false);
  assert.ok(result.errors.consent);
});

test('overlong fields and an unknown program are rejected before transmission', () => {
  const result = validateLead({ ...lead, name: 'А'.repeat(101), goal: 'я'.repeat(1001), program: 'unknown' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.name);
  assert.ok(result.errors.goal);
  assert.ok(result.errors.program);
});

test('draft preserves the person, selected program and goal in readable Russian', () => {
  assert.equal(buildTelegramDraft(lead), 'Здравствуйте! Хочу записаться на бесплатную первую консультацию в MinMin School.\n\nИмя: Анна\nКонтакт: @anna_school\nНаправление: Китайский для взрослых\nФормат: Помогите выбрать\nЦель: Хочу общаться в поездках');
});

test('Telegram URL keeps Cyrillic and query punctuation inside the message', () => {
  const result = new URL(buildTelegramUrl({ ...lead, name: 'Анна & Иван', goal: 'HSK? + разговор', format: 'pair' }));
  assert.equal(result.origin, 'https://t.me');
  assert.equal(result.pathname, '/minmin_school');
  assert.deepEqual([...result.searchParams.keys()], ['text']);
  assert.equal(result.searchParams.get('text'), 'Здравствуйте! Хочу записаться на бесплатную первую консультацию в MinMin School.\n\nИмя: Анна & Иван\nКонтакт: @anna_school\nНаправление: Китайский для взрослых\nФормат: В паре — 2 ученика\nЦель: HSK? + разговор');
});

test('unknown or malformed learning formats are rejected next to the format field', () => {
  for (const format of ['solo', 'unknown', null, 42, {}, false]) {
    const result = validateLead({ ...lead, format });
    assert.equal(result.valid, false, String(format));
    assert.ok(result.errors.format, String(format));
  }
});

test('legacy leads without a chosen format can still proceed', () => {
  for (const format of [undefined, '', '   ']) {
    assert.deepEqual(validateLead({ ...lead, format }), { valid: true, errors: {} });
    assert.match(buildTelegramDraft({ ...lead, format }), /\nФормат: Помогите выбрать\n/);
  }
});

for (const { format, label } of [
  { format: 'undecided', label: 'Помогите выбрать' },
  { format: 'individual', label: 'Индивидуально — 1 ученик' },
  { format: 'pair', label: 'В паре — 2 ученика' },
  { format: 'group', label: 'Мини-группа — 3–5 учеников' },
]) {
  test(`${format} format is accepted and included in the school message`, () => {
    assert.deepEqual(validateLead({ ...lead, format }), { valid: true, errors: {} });
    assert.ok(buildTelegramDraft({ ...lead, format }).includes(`\nФормат: ${label}\n`));
  });
}
