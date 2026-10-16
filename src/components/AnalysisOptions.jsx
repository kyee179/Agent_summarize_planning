import { BookOpen, Globe, Monitor, NotebookPen } from 'lucide-react';
import { Dialog } from './Dialog.jsx';
import { googleReadiness } from '../lib/dates.js';

export function sourceSummary(options) {
  return ['This journal', options.allowMemory && 'past notes', options.includeActivity && 'recorded activity', options.allowWebResearch && 'web search'].filter(Boolean).join(', ');
}

export function AnalysisOptions({ options, onChange, onClose, status, settings, onConnections }) {
  const provider = settings.effectiveAiProvider || settings.aiProvider;
  const readiness = googleReadiness(status, options.targetDate, settings.timezone);
  const rows = [
    { key: 'allowMemory', icon: NotebookPen, label: 'Past journals and notes', description: 'Find relevant goals and earlier reflections. Excerpts may be sent to your AI service.' },
    { key: 'includeActivity', icon: Monitor, label: 'Recorded app activity', description: 'Use saved activity from this journal’s date. This does not start recording or prove completion.' },
    { key: 'allowWebResearch', icon: Globe, label: 'Search the web', description: 'Find supporting information. Up to two queries may share task context with the search service.', unavailable: !status?.research?.configured }
  ];
  return <Dialog title="Customize analysis" onClose={onClose} className="analysis-options">
    <div className="dialog-body"><p className="muted">Choose the context for your next plan.</p>
      <div className="field-grid"><label>Plan for<input type="date" required value={options.targetDate} onChange={e => onChange({ ...options, targetDate: e.target.value })} /></label>
        <div className="timezone-label"><span>Timezone</span><strong>{settings.timezone}</strong></div></div>
      <label className="check-row"><input type="checkbox" checked={options.customAvailability} onChange={e => onChange({ ...options, customAvailability: e.target.checked })} />Choose different available hours for this plan</label>
      {options.customAvailability ? <div className="field-grid"><label>Available from<input type="time" required value={options.startsAt} onChange={e => onChange({ ...options, startsAt: e.target.value })} /></label><label>Available until<input type="time" required value={options.endsAt} onChange={e => onChange({ ...options, endsAt: e.target.value })} /></label></div>
        : <p className="helper">Uses your available hours in Settings: {(settings.defaultAvailability || []).map(x => `${x.startsAt}–${x.endsAt}`).join(', ') || 'not set'}.</p>}
      <div className="settings-group"><div className="setting-row"><span className="setting-icon"><BookOpen size={18} /></span><div><strong>This journal</strong><p>The starting point for this analysis.</p></div><span className="badge">Included</span></div>
        {rows.map(({ key, icon: Icon, label, description, unavailable }) => <div className="setting-row" key={key}>
          <span className="setting-icon"><Icon size={18} /></span><label className="setting-copy" htmlFor={`source-${key}`}><strong>{label}</strong><span>{description}</span></label>
          <input id={`source-${key}`} className="switch" type="checkbox" role="switch" checked={options[key]} disabled={unavailable} onChange={e => onChange({ ...options, [key]: e.target.checked })} aria-label={label} />
          {unavailable && <button className="text-button setting-help" type="button" onClick={onConnections}>Setup help</button>}
          {key === 'allowMemory' && !status?.memory?.chunks && <button className="text-button setting-help" type="button" onClick={onConnections}>Prepare past journals</button>}
        </div>)}</div>
      <p className="helper">{provider === 'local' ? 'Local rules run on this computer.' : `AI service: ${settings.aiModel || provider}. Your entry, related journal context, calendar context and enabled personal sources may be sent to this service.`} Optional switches allow additional retrieval or activity; connecting a service does not turn them on.</p>
      <div className={`inline-status ${readiness.ready ? '' : 'warning'}`}><strong>{readiness.label}</strong><span>Existing calendar commitments are reserved when scheduling.</span>{!readiness.ready && <button className="text-button" type="button" onClick={onConnections}>Open connections</button>}</div>
    </div><footer className="dialog-actions"><button className="secondary-button" type="button" onClick={() => onChange({ ...options, includeActivity: false, allowMemory: false, allowWebResearch: false })}>Reset sources</button><button className="primary-button" type="button" onClick={onClose}>Done</button></footer>
  </Dialog>;
}
