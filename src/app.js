import { programs, teachers } from './data.js';
import { programArt } from './artwork.js';
import { validateLead, buildTelegramDraft, buildTelegramUrl, formatLabels } from './lead.js';

const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const menuButton = $('#mobile-menu-toggle');
const navigation = $('#site-nav');
function closeMenu() {
  menuButton?.setAttribute('aria-expanded', 'false');
  navigation?.classList.remove('is-open');
}
menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(open));
  navigation?.classList.toggle('is-open', open);
});
navigation?.addEventListener('click', (event) => { if (event.target.closest('a')) closeMenu(); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menuButton?.getAttribute('aria-expanded') === 'true') {
    closeMenu();
    menuButton.focus();
  }
});
document.addEventListener('click', (event) => {
  if (menuButton?.getAttribute('aria-expanded') === 'true' && !navigation?.contains(event.target) && !menuButton.contains(event.target)) closeMenu();
});
window.matchMedia('(min-width: 701px)').addEventListener('change', (event) => { if (event.matches) closeMenu(); });

const header = $('#header');
const updateHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 16);
updateHeader();
window.addEventListener('scroll', updateHeader, { passive: true });

const tabs = $$('#program-tabs [data-program]');
const programPanel = $('#program-panel');
function selectProgram(id, focus = false) {
  const program = programs.find((item) => item.id === id);
  if (!program || !programPanel) return;
  for (const tab of tabs) {
    const selected = tab.dataset.program === id;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected) {
      if (!tab.id) tab.id = `program-tab-${id}`;
      programPanel.setAttribute('aria-labelledby', tab.id);
      if (focus) tab.focus();
    }
  }
  programPanel.dataset.program = id;
  programPanel.innerHTML = `
    <div class="program-visual" aria-hidden="true">${programArt[program.id] || ''}</div>
    <div class="program-copy">
      <p class="eyebrow">${escapeHTML(program.eyebrow)}</p>
      <h3>${escapeHTML(program.title)}</h3>
      <p>${escapeHTML(program.description)}</p>
    </div>
    <div class="program-details">
      <ul class="program-points">${program.points.map((point) => `<li>${escapeHTML(point)}</li>`).join('')}</ul>
      <p class="program-formats">${escapeHTML(program.formats)}</p>
      <button class="button button--primary" type="button" data-consultation data-program="${program.id}">${escapeHTML(program.cta)} <span aria-hidden="true">↗</span></button>
    </div>`;
}
for (const tab of tabs) {
  tab.addEventListener('click', () => selectProgram(tab.dataset.program));
  tab.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(tab);
    let next;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      selectProgram(tabs[next].dataset.program, true);
    }
  });
}
selectProgram(tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')?.dataset.program || 'children');

const contactSection = $('#contact');
const teacherDialog = $('#teacher-dialog');
const teacherContent = $('#teacher-dialog-content');
const returnFocus = new WeakMap();
function openDialog(dialog, opener) {
  if (!dialog || dialog.open) return;
  returnFocus.set(dialog, opener || document.activeElement);
  dialog.showModal();
  document.body.classList.add('has-open-dialog');
}
for (const dialog of $$('dialog')) {
  dialog.addEventListener('close', () => {
    if (!$('dialog[open]')) document.body.classList.remove('has-open-dialog');
    const opener = returnFocus.get(dialog);
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
}

const form = $('#consultation-form');
const feedback = $('#form-feedback');
const telegramLink = $('#telegram-draft');
const copyButton = $('#copy-message');
// Direct submission is enabled only after the server confirms that the Telegram bot is configured.
// On static hosting, or before the bot is set up, the form keeps the manual Telegram draft.
let submissionEndpoint;
let configuredEndpoint;
try {
  const configured = form?.dataset.endpoint?.trim();
  if (configured) {
    const url = new URL(configured, window.location.href);
    if (url.origin === window.location.origin) configuredEndpoint = url;
  }
} catch { /* Invalid endpoint configuration keeps the manual Telegram flow. */ }
function enableDirectSubmission(endpoint) {
  submissionEndpoint = endpoint;
  const explanation = $('#consultation-explanation');
  const consentCopy = $('#consent-copy');
  const submitCopy = $('#submit-copy');
  if (explanation) explanation.textContent = 'Передадим ваши имя, контакт и цель школе.';
  if (consentCopy) consentCopy.textContent = 'Согласен передать указанные имя, контакт и цель школе для связи по заявке.';
  if (submitCopy) submitCopy.textContent = 'Отправить заявку';
}
if (configuredEndpoint) {
  fetch(configuredEndpoint, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) })
    .then((response) => (response.ok ? response.json() : null))
    .then((status) => { if (status?.ok === true && status.configured === true) enableDirectSubmission(configuredEndpoint); })
    .catch(() => { /* No server: keep the manual Telegram flow. */ });
}
let preparedMessage = '';
let pending = false;
function setFeedback(message, state = 'idle') {
  if (!feedback) return;
  feedback.textContent = message;
  feedback.dataset.state = state;
}
function clearPrepared() {
  preparedMessage = '';
  if (telegramLink) telegramLink.hidden = true;
  if (copyButton) copyButton.hidden = true;
}
function field(name) { return form?.elements.namedItem(name); }
function clearFieldError(name) {
  field(name)?.removeAttribute('aria-invalid');
  const error = form && $(`[data-error-for="${name}"]`, form);
  if (error) error.textContent = '';
}
function showErrors(errors = {}) {
  if (!form) return;
  for (const name of ['name', 'contact', 'program', 'format', 'goal', 'consent']) {
    const input = field(name);
    const error = $(`[data-error-for="${name}"]`, form);
    if (input) {
      if (errors[name]) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    if (error) {
      error.textContent = errors[name] || '';
      if (!error.id) error.id = `consultation-error-${name}`;
      if (input && !input.getAttribute('aria-describedby')?.split(' ').includes(error.id)) {
        input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '));
      }
    }
  }
}
function prepareTelegram(lead, message) {
  preparedMessage = buildTelegramDraft(lead);
  if (telegramLink) {
    telegramLink.href = buildTelegramUrl(lead);
    telegramLink.hidden = false;
  }
  if (copyButton) copyButton.hidden = false;
  setFeedback(message || 'Сообщение подготовлено. Откройте Telegram и отправьте его школе. До этого заявка не отправлена.', 'ready');
}

document.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close-dialog]');
  if (close) { close.closest('dialog')?.close(); return; }
  const consultationButton = event.target.closest('[data-consultation]');
  if (consultationButton) {
    event.preventDefault();
    const program = consultationButton.dataset.program;
    if (program && programs.some((item) => item.id === program) && field('program') && field('program').value !== program) {
      field('program').value = program;
      clearPrepared();
      setFeedback('');
      clearFieldError('program');
    }
    const format = consultationButton.dataset.format;
    if (format && Object.hasOwn(formatLabels, format) && field('format') && field('format').value !== format) {
      field('format').value = format;
      clearPrepared();
      setFeedback('');
      clearFieldError('format');
    }
    const previousDialog = consultationButton.closest('dialog') || (teacherDialog?.open ? teacherDialog : null);
    if (previousDialog) returnFocus.delete(previousDialog);
    previousDialog?.close();
    closeMenu();
    contactSection?.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
    field('name')?.focus({ preventScroll: true });
    return;
  }
  const teacherButton = event.target.closest('[data-teacher]');
  if (!teacherButton || !teacherContent) return;
  const teacher = teachers.find((item) => item.id === teacherButton.dataset.teacher);
  if (!teacher) return;
  teacherContent.innerHTML = `
    <div class="teacher-profile">
      <img class="teacher-profile__photo" src="${escapeHTML(teacher.photo)}" alt="${escapeHTML(teacher.name)}" width="480" height="600">
      <div class="teacher-profile__body">
        <p class="eyebrow">${escapeHTML(teacher.role)}</p>
        <h2 id="teacher-dialog-title">${escapeHTML(teacher.name)}</h2>
        <p class="teacher-profile__qualification">${escapeHTML(teacher.qualification)}</p>
        <p>${escapeHTML(teacher.summary)}</p>
        <ul class="teacher-profile__facts">${teacher.facts.map((fact) => `<li>${escapeHTML(fact)}</li>`).join('')}</ul>
        <button class="button button--primary" type="button" data-consultation>Подобрать преподавателя <span aria-hidden="true">↗</span></button>
      </div>
    </div>`;
  teacherDialog?.setAttribute('aria-labelledby', 'teacher-dialog-title');
  openDialog(teacherDialog, teacherButton);
});

if (form) {
  form.noValidate = true;
  form.addEventListener('input', (event) => {
    if (pending) return;
    clearPrepared();
    setFeedback('');
    const name = event.target.name;
    if (name) clearFieldError(name);
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending) return;
    clearPrepared();
    const lead = {
      name: field('name')?.value || '', contact: field('contact')?.value || '',
      program: field('program')?.value || '', goal: field('goal')?.value || '',
      format: field('format')?.value || 'undecided',
      consent: field('consent')?.checked === true,
    };
    const validation = validateLead(lead);
    showErrors(validation.errors);
    if (!validation.valid) {
      setFeedback('Проверьте поля формы. ' + [validation.errors.program, validation.errors.format, validation.errors.goal].filter(Boolean).join(' '), 'error');
      field(Object.keys(validation.errors)[0])?.focus();
      return;
    }
    if (!submissionEndpoint) { prepareTelegram(lead); return; }
    const submitButton = $('[type="submit"]', form);
    pending = true;
    if (submitButton) submitButton.disabled = true;
    form.setAttribute('aria-busy', 'true');
    setFeedback('Передаём заявку школе…', 'pending');
    try {
      const response = await fetch(submissionEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lead), signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (response.ok && result.ok === true && result.code === 'sent') {
        setFeedback('Заявка отправлена школе. Мы свяжемся с вами по указанному контакту.', 'success');
      } else if (result.code === 'validation_error') {
        showErrors(result.errors);
        setFeedback('Проверьте поля формы перед отправкой.', 'error');
        field(Object.keys(result.errors || {})[0])?.focus();
      } else if (result.code === 'not_configured') {
        prepareTelegram(lead);
      } else {
        prepareTelegram(lead, result.code === 'delivery_unknown'
          ? 'Не удалось подтвердить доставку. Автоматического повтора не будет. Можно уточнить заявку у школы в Telegram.'
          : 'Не удалось отправить заявку через сайт. Сообщение подготовлено: откройте Telegram и отправьте его школе.');
      }
    } catch {
      prepareTelegram(lead, 'Не удалось подтвердить доставку. Автоматического повтора не будет. Можно уточнить заявку у школы в Telegram.');
    } finally {
      pending = false;
      if (submitButton) submitButton.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });
}
copyButton?.addEventListener('click', async () => {
  if (!preparedMessage) return;
  try {
    await navigator.clipboard.writeText(preparedMessage);
    setFeedback('Сообщение скопировано. Вставьте его в чат школы в Telegram и отправьте.', 'ready');
  } catch {
    setFeedback('Браузер не разрешил копирование. Откройте Telegram: сообщение будет подготовлено в чате.', 'ready');
  }
});

const revealElements = $$('[data-reveal]');
if (!reducedMotion.matches && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('reveal-enabled');
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
    }
  }, { threshold: 0.08 });
  for (const element of revealElements) observer.observe(element);
  reducedMotion.addEventListener('change', (event) => {
    if (event.matches) {
      document.documentElement.classList.remove('reveal-enabled');
      for (const element of revealElements) element.classList.add('is-visible');
      observer.disconnect();
    }
  });
} else {
  for (const element of revealElements) element.classList.add('is-visible');
}
