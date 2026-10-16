import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { IntegrationSettings } from './IntegrationSettings.jsx';
import { ResearchSources } from './ResearchSources.jsx';
import { api } from '../api.js';
vi.mock('../api.js', () => ({ api: { integrationStatus: vi.fn(), memoryNotes: vi.fn(), connectGoogle: vi.fn(), openGoogleConsent: vi.fn(), quickGoogleSync: vi.fn(), syncGoogle: vi.fn(), startDesktopActivity: vi.fn(), stopDesktopActivity: vi.fn(), research: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('integration setup and consent', () => {
  it('pauses an existing recording without starting capture or deleting its observations', async () => {
    let running = true;
    api.memoryNotes.mockResolvedValue([]);
    api.integrationStatus.mockImplementation(async () => ({ google: {}, memory: {}, research: {}, desktopActivity: { available: true, running } }));
    api.stopDesktopActivity.mockImplementation(async () => { running = false; });
    render(<IntegrationSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause recording' }));
    await screen.findByText(/Recording paused/);
    expect(api.stopDesktopActivity).toHaveBeenCalledOnce();
    expect(api.startDesktopActivity).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument();
  });
  it('refreshes the selected Google calendars instead of replacing them with the primary calendar', async () => {
    api.memoryNotes.mockResolvedValue([]);
    api.integrationStatus.mockResolvedValue({ google: { configured: true, connected: true, sync: { calendarIds: ['selected-work'] } }, memory: {}, research: {} });
    api.syncGoogle.mockResolvedValue({ imported: 0 });
    render(<IntegrationSettings settings={{ timezone: 'UTC' }} targetDate="2030-01-08" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh calendar' }));
    await waitFor(() => expect(api.syncGoogle).toHaveBeenCalledWith({ consent: true, calendarIds: ['selected-work'], from: '2030-01-07T23:45:00.000Z', to: '2030-01-16T00:15:00.000Z' }));
    expect(api.quickGoogleSync).not.toHaveBeenCalled();
  });
  it('renders missing-credential setup without asking for secrets and keeps actions behind consent', async () => {
    api.integrationStatus.mockResolvedValue({ google: { configured: false, connected: false }, memory: { model: 'nomic-embed-text' }, research: { configured: false } });
    api.memoryNotes.mockResolvedValue([]); render(<IntegrationSettings />);
    await screen.findByRole('button', { name: 'Setup help for Google Calendar' });
    expect(screen.queryByRole('button', { name: 'Connect Google Calendar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import activity' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Make past entries searchable' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Research with citations' })).toBeDisabled();
    expect(api.connectGoogle).not.toHaveBeenCalled(); expect(api.research).not.toHaveBeenCalled();
  });
  it('sends exactly the explicitly authorized manual research query and shows low confidence citations', async () => {
    api.integrationStatus.mockResolvedValue({ google: {}, memory: {}, research: { configured: true } }); api.memoryNotes.mockResolvedValue([]);
    api.research.mockResolvedValue({ results: [{ id: 'web:x', title: 'Source', url: 'https://example.com/docs', excerpt: 'Snippet', confidence: 'low', confidenceReason: 'Not page verified', retrievedAt: '2026-10-12T00:00:00Z' }] });
    render(<IntegrationSettings />); await screen.findByText(/Ready when you need it/);
    fireEvent.change(screen.getByLabelText('Research query'), { target: { value: 'task scope' } });
    expect(screen.getByRole('button', { name: 'Research with citations' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Send this query to Tavily'));
    fireEvent.click(screen.getByRole('button', { name: 'Research with citations' }));
    await waitFor(() => expect(api.research).toHaveBeenCalledWith('task scope'));
    expect(await screen.findByRole('link', { name: 'Source' })).toHaveAttribute('href', 'https://example.com/docs');
    expect(screen.getByText(/low confidence · Not page verified/)).toBeInTheDocument();
  });
  it('renders research snippets as text, with an external citation', () => {
    render(<ResearchSources results={[{ id: 'x', title: 'Primary source', url: 'https://example.com', excerpt: '<script>alert(1)</script>', confidence: 'low', confidenceReason: 'Snippet only', retrievedAt: '2026-10-12T00:00:00Z' }]} />);
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Primary source' })).toHaveAttribute('rel', 'noreferrer');
  });
  it('opens Google in the system browser and automatically syncs after consent completes', async () => {
    let state = 'initial';
    api.memoryNotes.mockResolvedValue([]);
    api.integrationStatus.mockImplementation(async () => ({ google: { configured: true, connected: state === 'connected', pending: state === 'waiting', lastOAuth: state === 'connected' ? 'connected' : 'waiting' }, memory: {}, research: {} }));
    api.connectGoogle.mockImplementation(async () => { state = 'waiting'; return { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic', expiresAt: '2030-01-01T00:00:00Z' }; });
    api.openGoogleConsent.mockResolvedValue({ opened: true }); api.quickGoogleSync.mockResolvedValue({ imported: 0 });
    render(<IntegrationSettings />); await waitFor(() => expect(screen.getByRole('button', { name: 'Connect Google Calendar' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Connect Google Calendar' }));
    await screen.findByText(/Complete Google sign-in/); expect(api.openGoogleConsent).toHaveBeenCalledOnce();
    state = 'connected';
    await waitFor(() => expect(api.quickGoogleSync).toHaveBeenCalledOnce(), { timeout: 3000 });
    expect(await screen.findByText(/Your primary calendar is reserved/)).toBeInTheDocument();
  });
  it('keeps polling while the callback exchanges tokens even if an interim response lacks pending', async () => {
    let state = 'initial';
    api.memoryNotes.mockResolvedValue([]);
    api.integrationStatus.mockImplementation(async () => ({ google: { configured: true, connected: state === 'connected', pending: state === 'waiting', lastOAuth: state === 'connected' ? 'connected' : state === 'exchanging' ? 'exchanging' : 'waiting' }, memory: {}, research: {} }));
    api.connectGoogle.mockImplementation(async () => { state = 'waiting'; return { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic', expiresAt: '2030-01-01T00:00:00Z' }; });
    api.openGoogleConsent.mockResolvedValue({ opened: true }); api.quickGoogleSync.mockResolvedValue({ imported: 0 });
    render(<IntegrationSettings />); await waitFor(() => expect(screen.getByRole('button', { name: 'Connect Google Calendar' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Connect Google Calendar' }));
    await screen.findByText(/Complete Google sign-in/); expect(screen.getByText('Connecting in your browser')).toBeInTheDocument();
    state = 'exchanging'; await waitFor(() => expect(api.integrationStatus.mock.calls.length).toBeGreaterThanOrEqual(3), { timeout: 3000 });
    expect(screen.queryByText(/Google authorization ended/)).not.toBeInTheDocument(); expect(api.quickGoogleSync).not.toHaveBeenCalled();
    state = 'connected'; await waitFor(() => expect(api.quickGoogleSync).toHaveBeenCalledOnce(), { timeout: 3000 });
    expect(await screen.findByText(/Your primary calendar is reserved/)).toBeInTheDocument();
  }, 10000);
  it('starts desktop activity only after the user presses the enable button', async () => {
    api.memoryNotes.mockResolvedValue([]); api.integrationStatus.mockResolvedValue({ google: {}, memory: {}, research: {}, desktopActivity: { available: true, running: false } });
    api.startDesktopActivity.mockResolvedValue({ enabled: true }); render(<IntegrationSettings />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start recording' })).not.toBeDisabled());
    expect(api.startDesktopActivity).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    await screen.findByText(/Desktop activity enabled for this app session/); expect(api.startDesktopActivity).toHaveBeenCalledOnce();
  });
});
