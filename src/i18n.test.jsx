import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App.jsx';
import { AuthGate } from './features/AuthGate.jsx';
import { EventDrawer } from './components/EventDrawer.jsx';
import { TaskFacts } from './components/TaskFacts.jsx';
import { LanguageSwitch } from './components/LanguageSwitch.jsx';
import { AnalysisSummaries } from './components/AnalysisSummaries.jsx';
import { api } from './api.js';
import { dateKey, dateLabel, timeLabel } from './lib/dates.js';
import { getLocale, LANGUAGE_KEY, messageText, setLocale, t } from './i18n/index.js';
import zhCN from './i18n/zh-CN.json';

vi.mock('./api.js', async original => {
  const source = await original();
  return { ...source, invalidateRequests: vi.fn(), api: Object.fromEntries(Object.keys(source.api).map(key => [key, vi.fn()])) };
});
const day = dateKey(new Date(), 'UTC');
const entry = { id: 'j', title: 'Today', content: 'Keep this English text. 明天复查。', journalDate: day, type: 'daily', tags: [], bookmarked: false };
const settings = { timezone: 'UTC', weekStartsOn: 1, defaultNotifyMinutesBefore: 15, aiProvider: 'local', effectiveAiProvider: 'local', defaultAvailability: [{ label: 'Focus', startsAt: '09:00', endsAt: '17:00' }] };
const welcome = { session: null, provider: { configured: true }, secureStorage: true, localProfiles: [{ id: 'local', name: 'Local workspace' }] };
beforeEach(() => {
  setLocale('en'); vi.resetAllMocks();
  api.authStatus.mockResolvedValue(welcome); api.getSettings.mockResolvedValue(settings);
  api.listJournals.mockResolvedValue([entry]); api.listEvents.mockResolvedValue([]);
  api.integrationStatus.mockResolvedValue({ google: {}, research: {}, memory: {}, desktopActivity: {} });
  api.memoryNotes.mockResolvedValue([]); api.getJournalAnalysis.mockResolvedValue(null);
  api.updateJournal.mockImplementation(async (_id, payload) => ({ ...entry, ...payload }));
});
afterEach(() => { cleanup(); setLocale('en'); vi.restoreAllMocks(); });

it('switches welcome screens without losing form input and survives a storage refresh', async () => {
  render(<AuthGate />); await screen.findByRole('heading', { name: 'Welcome back' });
  fireEvent.change(screen.getByLabelText('Email', { exact: true }), { target: { value: 'reader@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Switch to Chinese' }));
  expect(screen.getByRole('heading', { name: '欢迎回来' })).toBeInTheDocument();
  expect(screen.getByLabelText('邮箱', { exact: true })).toHaveValue('reader@example.test');
  expect(document.documentElement.lang).toBe('zh-CN');
  expect(localStorage.getItem(LANGUAGE_KEY)).toBe('zh-CN');
  expect(screen.getByRole('button', { name: '创建账户' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '离线使用' })).toBeInTheDocument();
  act(() => { localStorage.setItem(LANGUAGE_KEY, 'en'); window.dispatchEvent(new StorageEvent('storage', { key: LANGUAGE_KEY })); });
  expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  expect(api.authStatus).toHaveBeenCalledOnce();
});

it('keeps unsaved journal text and analysis permissions across toggles without reloading data', async () => {
  render(<App />); await screen.findByRole('heading', { name: 'On your calendar' });
  fireEvent.click(screen.getByRole('button', { name: 'Journal', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: /^Today.+daily$/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare plan' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Journal text'), { target: { value: 'Unsaved English. 未保存的中文。' } });
  const loads = api.listEvents.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Switch to Chinese' }));
  expect(screen.getByLabelText('日记正文')).toHaveValue('Unsaved English. 未保存的中文。');
  expect(screen.getByLabelText('日记标题')).toHaveValue('Today');
  expect(screen.getByText('未保存的更改')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: '自定义分析' })[0]);
  const dialog = screen.getByRole('dialog', { name: '自定义分析' });
  expect(within(dialog).getByLabelText('分析输出语言')).toHaveValue('auto');
  within(dialog).getAllByRole('switch').forEach(control => expect(control).not.toBeChecked());
  act(() => setLocale('en'));
  expect(screen.getByRole('dialog', { name: 'Customize analysis' })).toBeInTheDocument();
  expect(screen.getByLabelText('Journal text')).toHaveValue('Unsaved English. 未保存的中文。');
  expect(api.listEvents).toHaveBeenCalledTimes(loads);
  expect(api.updateJournal).not.toHaveBeenCalled();
  expect(api.analyzeJournal).not.toHaveBeenCalled();
});

it('translates event options while keeping their original API values', async () => {
  act(() => setLocale('zh-CN')); api.createEvent.mockResolvedValue({ id: 'event' });
  render(<><LanguageSwitch /><EventDrawer entry={{ date: day }} settings={settings} onSaved={vi.fn()} onClose={vi.fn()} /></>);
  fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Calendar' } });
  const reminder = screen.getByLabelText('提醒类型');
  expect(within(reminder).getByRole('option', { name: '桌面通知' })).toHaveValue('Desktop notification');
  fireEvent.change(reminder, { target: { value: 'Silent reminder' } });
  fireEvent.change(screen.getByLabelText('重复'), { target: { value: 'weekly' } });
  fireEvent.click(screen.getByRole('button', { name: '切换到英语' }));
  expect(screen.getByLabelText('Reminder type')).toHaveValue('Silent reminder');
  expect(screen.getByLabelText('Repeat')).toHaveValue('weekly');
  fireEvent.click(screen.getByRole('button', { name: 'Save event' }));
  await waitFor(() => expect(api.createEvent).toHaveBeenCalledWith(expect.objectContaining({ title: 'Calendar', repeat: 'weekly', notificationFormat: 'Silent reminder' })));
});

it('allows switching during analysis without cancelling or repeating the request', async () => {
  let finish;
  api.analyzeJournal.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<App />); await screen.findByRole('heading', { name: 'On your calendar' });
  fireEvent.click(screen.getByRole('button', { name: 'Journal', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: /^Today.+daily$/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare plan' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Prepare plan' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Generate summary and plan' }));
  await waitFor(() => expect(api.analyzeJournal).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Switch to Chinese' }));
  await act(async () => finish({ id: 'a', journalId: 'j', provider: 'local', summary: 'Today', weeklySummary: 'Calendar', tasks: [], scheduleDrafts: [], cautions: [] }));
  expect(await screen.findByText('等待审核')).toBeInTheDocument();
  expect(api.analyzeJournal).toHaveBeenCalledOnce();
  expect(api.analyzeJournal).toHaveBeenCalledWith('j', expect.objectContaining({ outputLanguage: 'auto', allowMemory: false }));
  expect(api.applyDrafts).not.toHaveBeenCalled();
  expect(screen.getByText('Today', { selector: 'p' })).toBeInTheDocument();
});

it('preserves task status, scope and category values in the Chinese task editor', async () => {
  setLocale('zh-CN');
  render(<TaskFacts task={{ id: 't', importance: { level: 'medium' }, dependsOn: [] }} record={{ title: 'Today', status: 'open', revision: 1, confirmed: {}, scope: 'remaining_task', baseline: 60, sessionEventIds: [] }} tasks={[]} timezone="UTC" onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.getByLabelText('任务标题')).toHaveValue('Today');
  expect(screen.getByLabelText('任务状态')).toHaveValue('open');
  expect(screen.getByLabelText('预计投入范围')).toHaveValue('remaining_task');
  const type = screen.getByLabelText('工作类型');
  expect(within(type).getByRole('option', { name: '编程' })).toHaveValue('coding');
  fireEvent.change(type, { target: { value: 'coding' } });
  fireEvent.click(screen.getByRole('button', { name: '确认并保存任务信息' }));
  await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('t', expect.objectContaining({ status: 'open', title: 'Today', estimateScope: 'remaining_task', estimateFeatures: expect.objectContaining({ category: 'coding' }) })));
});

it('leaves generated content and evidence verbatim even when they equal UI keys', () => {
  setLocale('zh-CN');
  render(<AnalysisSummaries analysis={{ summary: 'Today', weeklySummary: 'Calendar', contract: { evidence: [{ id: 'e', sourceType: 'journal', sourceId: 'j', verification: 'unverified', excerpt: 'Settings' }] }, agentWorkflow: { summaryEvidenceIds: ['e'] } }} />);
  expect(screen.getByRole('heading', { name: '总结' })).toBeInTheDocument();
  expect(screen.getByText('Today')).toBeInTheDocument();
  expect(screen.getByText('Calendar')).toBeInTheDocument();
  expect(screen.getByText('Settings')).toBeInTheDocument();
});

it('formats visible dates and time in the chosen locale without changing ISO keys', () => {
  const instant = new Date('2030-01-07T13:05:00Z');
  setLocale('en'); expect(dateLabel('2030-01-07')).toBe('January 7');
  setLocale('zh-CN'); expect(dateLabel('2030-01-07')).toBe('1月7日');
  expect(timeLabel(instant, 'UTC')).toBe('13:05');
  expect(dateKey(instant, 'UTC')).toBe('2030-01-07');
});

it('translates existing notices and known templates with safe fallback for diagnostics', () => {
  setLocale('zh-CN');
  expect(messageText('Settings saved.')).toBe('设置已保存。');
  expect(messageText('Save failed. The event must end after it starts.')).toBe('保存失败。日程结束时间必须晚于开始时间。');
  expect(messageText('Settings saved. (request abc-123)')).toBe('设置已保存。（请求 abc-123）');
  expect(t('Close {p0}', { p0: '<script>' })).toBe('关闭<script>');
  expect(t('Unknown provider diagnostic')).toBe('Unknown provider diagnostic');
  setLocale('en'); expect(messageText('Settings saved.')).toBe('Settings saved.');
});

it('works when browser storage is unavailable and rejects unsupported locales', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled'); });
  render(<LanguageSwitch />); fireEvent.click(screen.getByRole('button', { name: 'Switch to Chinese' }));
  expect(getLocale()).toBe('zh-CN'); expect(document.documentElement.lang).toBe('zh-CN');
  setLocale('unsupported'); expect(getLocale()).toBe('zh-CN');
});

it('has no empty translations or invented interpolation parameters', () => {
  for (const [key, value] of Object.entries(zhCN)) {
    expect(value.trim(), key).not.toBe('');
    const keys = [...key.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
    for (const match of value.matchAll(/\{(\w+)\}/g)) expect(keys, key).toContain(match[1]);
  }
});
