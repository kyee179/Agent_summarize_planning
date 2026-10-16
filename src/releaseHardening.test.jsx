import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspace } from './app/useWorkspace.js';
import { api } from './api.js';
import { ServiceSetup } from './components/ServiceSetup.jsx';
import { TaskFacts } from './components/TaskFacts.jsx';
vi.mock('./api.js', async original => { const value = await original(); return { ...value, api: Object.fromEntries(Object.keys(value.api).map(k => [k, vi.fn()])) }; });
const settings = { timezone: 'UTC', weekStartsOn: 1, aiProvider: 'local', defaultAvailability: [{ startsAt: '09:00', endsAt: '17:00' }] };
const a = { id: 'a', title: 'A', content: 'I need to prepare A.', type: 'daily', journalDate: '2030-01-07', tags: [], bookmarked: false };
const b = { ...a, id: 'b', title: 'B' };
beforeEach(() => {
  vi.clearAllMocks(); api.getSettings.mockResolvedValue(settings); api.listJournals.mockResolvedValue([a, b]); api.integrationStatus.mockResolvedValue({}); api.listEvents.mockResolvedValue([]);
  api.getJournalAnalysis.mockResolvedValue({ id: 'old', journalId: 'a', scheduleDrafts: [{ title: 'A' }] }); api.updateSettings.mockImplementation(async patch => ({ ...settings, ...patch }));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); delete window.studyCalendar; });

describe('release state safety', () => {
  it('invalidates a ready plan when its analysis options change', async () => {
    const { result } = renderHook(() => useWorkspace()); await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.selectJournal(a); }); expect(result.current.phase).toBe('ready');
    act(() => result.current.setOptions(current => ({ ...current, allowMemory: true })));
    expect(result.current.phase).toBe('stale'); await act(async () => { await result.current.apply(); }); expect(api.applyDrafts).not.toHaveBeenCalled();
  });
  it('keeps the operation busy after invalidation and rejects its late result', async () => {
    let resolve;
    api.analyzeJournal.mockImplementation(() => new Promise(r => { resolve = r; }));
    const { result } = renderHook(() => useWorkspace());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.selectJournal(a); });
    let generation;
    await act(async () => { generation = result.current.generate(); });
    await act(async () => { await result.current.updateSettings({ defaultNotifyMinutesBefore: 20 }); });
    expect(result.current.busy).toBe(true);
    await act(async () => { await result.current.selectJournal(b); });
    expect(result.current.journal.id).toBe('a');
    await act(async () => { resolve({ id: 'new', journalId: 'a', scheduleDrafts: [{ title: 'A' }] }); await generation; });
    expect(result.current.phase).toBe('stale'); expect(result.current.busy).toBe(false);
    await act(async () => { await result.current.apply(); }); expect(api.applyDrafts).not.toHaveBeenCalled();
  });
  it('never exposes a result returned for a different journal', async () => {
    api.analyzeJournal.mockResolvedValue({ id: 'wrong', journalId: 'b', scheduleDrafts: [{ title: 'B' }] });
    const { result } = renderHook(() => useWorkspace()); await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.selectJournal(a); });
    await act(async () => { await result.current.generate(); });
    expect(result.current.phase).toBe('stale'); expect(result.current.analysis?.id).not.toBe('wrong');
  });
});

describe('user-confirmed configuration', () => {
  it('saves credentials only on explicit submission and clears password fields afterward', async () => {
    const saveSetup = vi.fn().mockResolvedValue({ secureStorage: true, configured: {}, restartRequired: true });
    window.studyCalendar = { setupStatus: async () => ({ secureStorage: true, configured: {} }), saveSetup, restart: vi.fn() };
    render(<ServiceSetup settings={{ aiProvider: 'glm' }} />);
    await waitFor(() => expect(screen.getByLabelText('Service API key')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('Service API key'), { target: { value: 'synthetic-key' } }); expect(saveSetup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save service setup' }));
    await waitFor(() => expect(saveSetup).toHaveBeenCalledWith({ AI_PROVIDER: 'glm', GLM_API_KEY: 'synthetic-key' }));
    expect(screen.getByLabelText('Service API key')).toHaveValue(''); expect(screen.getByRole('button', { name: 'Restart app' })).toBeVisible();
  });
  it('converts an explicitly confirmed deadline in the plan timezone before saving', async () => {
    api.updateTask.mockResolvedValue({}); const onSaved = vi.fn();
    const task = { id: 'task:a', title: 'A', dependsOn: [], importance: { level: 'low' } };
    render(<TaskFacts task={task} record={{ id: 'task:a', title: 'A', status: 'open', revision: 2, confirmed: {}, sessionEventIds: [] }} tasks={[task]} timezone="Asia/Shanghai" onClose={() => {}} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Confirmed deadline (Asia/Shanghai)'), { target: { value: '2030-01-07T16:00' } });
    fireEvent.change(screen.getByLabelText('Confirmed effort in minutes'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and save facts' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(api.updateTask).toHaveBeenCalledWith('task:a', expect.objectContaining({ revision: 2, deadline: { at: '2030-01-07T08:00:00.000Z', kind: 'hard' }, effort: { minutes: 30, scope: 'next_session' } }));
  });
});
