import { t, useLocale } from '../i18n/index.js';
export function ResearchSources({ results = [] }) {
  useLocale();
  if (!results.length) return null;
  return <section aria-label={t("Research sources")}><h3>{t("Web research sources")}</h3>
    <p>{t("These are search snippets. Personal deadlines and effort still need confirmation.")}</p>
    {results.map((item) => <blockquote key={item.id}>
      <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
      <p>{item.excerpt}</p><small>{t(item.confidence)}{t(" confidence · ")}{item.confidenceReason}{t(" Retrieved ")}{item.retrievedAt}</small>
    </blockquote>)}
  </section>;
}
