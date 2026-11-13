import { t, useLocale } from '../i18n/index.js';
import { ResearchSources } from './ResearchSources.jsx';
export function AnalysisSummaries({ analysis }) {
  useLocale();
  const evidence = new Map((analysis.contract?.evidence || []).map((item) => [item.id, item]));
  const sources = (ids = []) => ids.map((id) => evidence.get(id)).filter(Boolean);
  const sections = [
    { title: "Summary", text: analysis.summary, ids: analysis.agentWorkflow?.summaryEvidenceIds },
    { title: "Journal context", text: analysis.weeklySummary, ids: analysis.agentWorkflow?.weeklySummaryEvidenceIds }
  ];
  return <>{analysis.evidenceCoverage && <section><h3>{t("Journal coverage")}</h3><p>{analysis.evidenceCoverage.partial ? t("Partial analysis: some journal text was not included.") : t("All journal text fit within the evidence budget.")}</p>{analysis.evidenceCoverage.sources.map(source => <p key={source.sourceId}>{source.includedCharacters}{t(" of ")}{source.totalCharacters}{t(" text characters included")}{source.omittedCharacters ? t("; {p0} omitted", {p0: source.omittedCharacters}) : ''}.</p>)}</section>}{sections.map(({ title, text, ids }) => <section key={title}>
    <h3>{t(title)}</h3><p>{text}</p>
    {sources(ids).length > 0 && <details><summary>{t(title)}{t(" sources")}</summary>
      {sources(ids).map((source) => <p key={source.id}><small>{t(source.sourceType)}: {source.sourceId} · {t((source.verification || 'unverified').replaceAll('_', ' '))}</small><br />{source.excerpt}
        {source.locator && <><br /><a href={source.locator} target="_blank" rel="noreferrer">{t("Open source")}</a></>}
      </p>)}
    </details>}
  </section>)}<ResearchSources results={analysis.research} /></>;
}
