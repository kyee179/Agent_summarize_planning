import { ResearchSources } from './ResearchSources.jsx';
export function AnalysisSummaries({ analysis }) {
  const evidence = new Map((analysis.contract?.evidence || []).map((item) => [item.id, item]));
  const sources = (ids = []) => ids.map((id) => evidence.get(id)).filter(Boolean);
  const sections = [
    { title: "Summary", text: analysis.summary, ids: analysis.agentWorkflow?.summaryEvidenceIds },
    { title: "Journal context", text: analysis.weeklySummary, ids: analysis.agentWorkflow?.weeklySummaryEvidenceIds }
  ];
  return <>{sections.map(({ title, text, ids }) => <section key={title}>
    <h3>{title}</h3><p>{text}</p>
    {sources(ids).length > 0 && <details><summary>{title} sources</summary>
      {sources(ids).map((source) => <p key={source.id}><small>{source.sourceType}: {source.sourceId} · {(source.verification || 'unverified').replaceAll('_', ' ')}</small><br />{source.excerpt}
        {source.locator && <><br /><a href={source.locator} target="_blank" rel="noreferrer">Open source</a></>}
      </p>)}
    </details>}
  </section>)}<ResearchSources results={analysis.research} /></>;
}
