import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Diagnostics } from './Diagnostics.jsx';
import { api } from '../api.js';
vi.mock('../api.js', () => ({ api: { diagnostics: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('Diagnostics', () => {
  it('shows sample limits, alerts and unknown latency without probing sources', async () => {
    api.diagnostics.mockResolvedValue({ ready: true, appVersion: '0.3.0', database: { schemaVersion: 2 }, promptVersion: '1.1.0',
      telemetry: { windowMinutes: 10, sampleLimit: 512, window: { analysisSamples: 0, fallbackRate: null, p95Ms: null }, recent: [] }, alerts: ['google_cache_needs_sync'] });
    render(<Diagnostics />); fireEvent.click(screen.getByText('Check health'));
    expect(await screen.findByText(/Database ready/)).toBeInTheDocument();
    expect(screen.getByText(/fallback no samples/)).toBeInTheDocument(); expect(screen.getByText(/fresh sync/)).toBeInTheDocument();
  });
  it('shows a failed authenticated monitoring request', async () => {
    api.diagnostics.mockRejectedValue(new Error('Check failed'));
    render(<Diagnostics />); fireEvent.click(screen.getByText('Check health'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Check failed');
  });
});
