import { useSyncExternalStore } from 'react';
import zhCN from './zh-CN.json';

export const LANGUAGE_KEY = 'calendar.uiLanguage';
export const SUPPORTED_LOCALES = ['en', 'zh-CN'];
const listeners = new Set();
function savedLocale() {
  try { return localStorage.getItem(LANGUAGE_KEY) === 'zh-CN' ? 'zh-CN' : 'en'; }
  catch { return 'en'; }
}
let locale = savedLocale();
export const getLocale = () => locale;
function updateDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.title = locale === 'zh-CN' ? '日历 · 总结与规划' : 'Agent Planning Calendar';
}
updateDocument();
export function setLocale(next) {
  if (!SUPPORTED_LOCALES.includes(next)) return;
  locale = next;
  try { localStorage.setItem(LANGUAGE_KEY, next); } catch { /* The choice still works for this session. */ }
  updateDocument();
  listeners.forEach(listener => listener());
}
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === LANGUAGE_KEY || event.key === null) {
    locale = savedLocale(); updateDocument(); listeners.forEach(listener => listener());
  }
});
function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function useLocale() { return useSyncExternalStore(subscribe, getLocale, () => 'en'); }

// Only application-owned labels and messages pass through this function.
// Journal text, task names, evidence, account names and model output stay verbatim.
export function t(key, values = {}) {
  if (typeof key !== 'string') return key;
  const text = locale === 'zh-CN' ? (zhCN[key] ?? zhCN[key.trim()] ?? key) : key;
  return text.replace(/\{(\w+)\}/g, (placeholder, name) => Object.hasOwn(values, name) ? String(values[name]) : placeholder);
}

// Stored asynchronous messages remain in their source language so a later toggle
// also translates notices that were already on screen. Match known app templates only.
const messageTemplates = [
  'Calendar could not load. {p0}', 'Could not load the saved analysis. {p0}', 'Save failed. {p0}',
  '{p0} text sections are ready for local search. Choose whether an analysis may use them in Customize analysis.',
  '{p0} text sections prepared in {p1} mode. {p2}',
  'Imported {p0} activity intervals. Observation does not prove completion.',
  '{p0} sources found.{p1}', ' Reported search credits: {p0}.',
];
const patterns = messageTemplates.map(key => ({ key, regex: new RegExp('^' + key.split(/\{\w+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('([\\s\\S]*?)') + '$'), names: [...key.matchAll(/\{(\w+)\}/g)].map(match => match[1]) }));
export function messageText(message) {
  if (locale !== 'zh-CN' || typeof message !== 'string') return message;
  const request = message.match(/^([\s\S]*) \(request ([a-zA-Z0-9_-]{1,128})\)$/);
  if (request) return messageText(request[1]) + t(' (request {p0})', { p0: request[2] });
  if (Object.hasOwn(zhCN, message) || Object.hasOwn(zhCN, message.trim())) return t(message);
  for (const { key, regex, names } of patterns) {
    const match = message.match(regex);
    if (match) return t(key, Object.fromEntries(names.map((name, i) => [name, messageText(match[i + 1])])));
  }
  return message;
}
