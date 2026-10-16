import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App.jsx';
import { api, ApiError } from './api.js';
import { dateKey } from './lib/dates.js';
import { EventDrawer } from './components/EventDrawer.jsx';

vi.mock('./api.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, api: Object.fromEntries(Object.keys(original.api).map(key => [key, vi.fn()])) };
});
const day = dateKey(new Date(), 'UTC');
const entry = { id: 'j', title: 'A useful day', content: 'I need to review the project.', journalDate: day, type: 'daily', bookmarked: false, tags: [] };
const analysis = { id: 'a', journalId: 'j', provider: 'local', summary: 'Project review remains.', weeklySummary: 'Selected journal context only.', tasks: [], cautions: [],
  scheduleDrafts: [{ title: 'Review the project', startsAt: `${day}T18:00:00Z`, endsAt: `${day}T18:30:00Z` }] };
beforeEach(() => {
  vi.clearAllMocks();
  api.getSettings.mockResolvedValue({ timezone: 'UTC', weekStartsOn: 1, defaultNotifyMinutesBefore: 15, aiProvider: 'local', effectiveAiProvider: 'local', defaultAvailability: [{ label: 'Focus', startsAt: '09:00', endsAt: '17:00' }] });
  api.listJournals.mockResolvedValue([entry]); api.listEvents.mockResolvedValue([]);
  api.integrationStatus.mockResolvedValue({ google: { configured: false }, research: { configured: true }, memory: {}, desktopActivity: { available: true, running: false } });
  api.memoryNotes.mockResolvedValue([]); api.getJournalAnalysis.mockResolvedValue(null);
  api.updateJournal.mockImplementation(async (_id, body) => ({ ...entry, ...body }));
  api.createJournal.mockImplementation(async body => ({ ...body, id: 'new' }));
  api.analyzeJournal.mockResolvedValue(analysis); api.applyDrafts.mockResolvedValue({ events: [], replayed: false });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
async function openJournal() {
  await screen.findByRole('button', { name: 'Journal', exact: true });
  await waitFor(() => expect(screen.queryByText('Loading your workspace…')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Journal', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: /A useful day/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare plan' })).not.toBeDisabled());
}
describe('redesigned daily workflow', () => {
  it('submits a new manual event only once while a save is pending', async () => {
    let finish;
    api.createEvent.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const onSaved = vi.fn();
    render(<EventDrawer entry={{ date: day }} settings={{ timezone: 'UTC', defaultNotifyMinutesBefore: 15 }} onSaved={onSaved} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Synthetic event' } });
    const form = document.querySelector('dialog form');
    fireEvent.submit(form); fireEvent.submit(form);
    expect(api.createEvent).toHaveBeenCalledTimes(1);
    finish({ id: 'synthetic' });
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });
  it('offers a startup retry instead of presenting failed loading as an empty personal calendar', async () => {
    api.getSettings.mockRejectedValueOnce(new Error('Local API unavailable'));
    render(<App />);
    await screen.findByRole('heading', { name: 'Your workspace couldn’t load' });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'On your calendar' })).toBeInTheDocument());
  });
  it('keeps optional sources off and separates source permission from recording', async () => {
    render(<App />); await openJournal();
    fireEvent.click(screen.getAllByRole('button', { name: 'Customize analysis' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Customize analysis' });
    const switches = within(dialog).getAllByRole('switch');
    expect(switches).toHaveLength(3); switches.forEach(control => expect(control).not.toBeChecked());
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Recorded app activity' }));
    expect(api.startDesktopActivity).not.toHaveBeenCalled(); expect(api.analyzeJournal).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Prepare plan' }));
    await screen.findByRole('button', { name: 'Generate summary and plan' });
    fireEvent.click(screen.getByRole('button', { name: 'Generate summary and plan' }));
    await waitFor(() => expect(api.analyzeJournal).toHaveBeenCalledExactlyOnceWith('j', { targetDate: day, includeActivity: true, allowMemory: false, allowWebResearch: false, outputLanguage: 'auto' }));
    await screen.findByText('Ready for review');
    expect(api.applyDrafts).not.toHaveBeenCalled();
  });
  it('protects unsaved writing when creating another entry', async () => {
    render(<App />); await openJournal();
    fireEvent.change(screen.getByLabelText('Journal text'), { target: { value: 'My unsaved reflection.' } });
    fireEvent.click(screen.getByRole('button', { name: 'New entry' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Keep your journal changes?' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Journal text')).toHaveValue('My unsaved reflection.');
    expect(api.createJournal).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Entry date'), { target: { value: '' } });
    expect(screen.getByRole('heading', { name: 'Choose a date' })).toBeInTheDocument();
  });
  it('requires new review after a stale Apply and never applies automatically', async () => {
    api.applyDrafts.mockRejectedValueOnce(new ApiError(409, { error: 'Calendar changed. Generate again.' }));
    render(<App />); await openJournal();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare plan' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Generate summary and plan' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add all to local calendar' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Add all to local calendar' }));
    await screen.findByText('Review needs updating');
    expect(screen.getByRole('button', { name: 'Add all to local calendar' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Generate new plan' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add all to local calendar' })).not.toBeDisabled());
    expect(api.applyDrafts).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Add all to local calendar' }));
    await screen.findByText('Your plan is on the calendar.');
    expect(api.applyDrafts).toHaveBeenCalledTimes(2);
    expect(api.updateJournal).not.toHaveBeenCalled();
  });
  it('shows weekday headers in the configured week order and protects event editing focus', async () => {
    render(<App />); await waitFor(() => expect(screen.queryByText('Loading your workspace…')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Calendar', exact: true }));
    expect(screen.getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute('aria-current', 'page');
    expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: 'Today', exact: true })).not.toHaveAttribute('aria-current');
    expect(document.querySelector('.weekday').textContent).toBe('Mon');
    fireEvent.click(screen.getByRole('button', { name: 'Add event', exact: true }));
    const dialog = await screen.findByRole('dialog', { name: 'Add event' });
    expect(within(dialog).getByLabelText('Title')).toHaveFocus();
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Unsaved event' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Add event' }));
    expect(await screen.findByRole('dialog', { name: 'Discard event changes?' })).toBeInTheDocument();
    expect(api.createEvent).not.toHaveBeenCalled();
  });
});
