import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { IntegrationSettings } from './IntegrationSettings.jsx';
import { ResearchSources } from './ResearchSources.jsx';
import { api } from '../api.js';
vi.mock('../api.js', () => ({ api: { integrationStatus: vi.fn(), memoryNotes: vi.fn(), connectGoogle: vi.fn(), research: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('integration setup and consent', () => {
  it('renders missing-credential setup without asking for secrets and keeps actions behind consent', async () => {
    api.integrationStatus.mockResolvedValue({ google: { configured: false, connected: false }, memory: { model: 'nomic-embed-text' }, research: { configured: false } });
    api.memoryNotes.mockResolvedValue([]); render(<IntegrationSettings />);
    await screen.findByText(/Credentials needed/);
    expect(screen.getByRole('button', { name: 'Prepare Google connection' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Import activity' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rebuild memory index' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Research with citations' })).toBeDisabled();
    expect(api.connectGoogle).not.toHaveBeenCalled(); expect(api.research).not.toHaveBeenCalled();
  });
  it('sends exactly the explicitly authorized manual research query and shows low confidence citations', async () => {
    api.integrationStatus.mockResolvedValue({ google: {}, memory: {}, research: { configured: true } }); api.memoryNotes.mockResolvedValue([]);
    api.research.mockResolvedValue({ results: [{ id: 'web:x', title: 'Source', url: 'https://example.com/docs', excerpt: 'Snippet', confidence: 'low', confidenceReason: 'Not page verified', retrievedAt: '2026-10-12T00:00:00Z' }] });
    render(<IntegrationSettings />); await screen.findByText(/Search configured/);
    fireEvent.change(screen.getByLabelText('Research query'), { target: { value: 'task scope' } });
    expect(screen.getByRole('button', { name: 'Research with citations' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Send this query to Brave Search'));
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
});
