import { messages } from './messages.mjs';

export const locales = ['en','ko','ja','zh-CN'];
export function resolveLocale(value) {
  const language = String(value ?? '').toLowerCase();
  if (language === 'zh' || language.startsWith('zh-cn') || language.startsWith('zh-hans')) return 'zh-CN';
  return ['en','ko','ja'].find(locale=>language === locale || language.startsWith(locale+'-')) ?? 'en';
}
export function createTranslator(locale) {
  const catalog = messages[resolveLocale(locale)];
  return (key,...values) => (catalog[key] ?? messages.en[key] ?? key).replace(/\{(\d+)\}/g,(match,index)=>index < values.length ? String(values[index]) : match);
}
export function translateDocument(document,locale) {
  const msg = createTranslator(locale);
  document.documentElement.lang = resolveLocale(locale);
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = msg(node.getAttribute('data-i18n'));
  for (const attribute of ['aria-label','placeholder','oai-annotatable']) {
    for (const node of document.querySelectorAll(`[data-i18n-${attribute}]`)) node.setAttribute(attribute,msg(node.getAttribute(`data-i18n-${attribute}`)));
  }
}
