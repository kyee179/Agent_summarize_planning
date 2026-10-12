export function ResearchSources({ results = [] }) {
  if (!results.length) return null;
  return <section aria-label="Research sources"><h3>Web research sources</h3>
    <p>These are search snippets. Personal deadlines and effort still need confirmation.</p>
    {results.map((item) => <blockquote key={item.id}>
      <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
      <p>{item.excerpt}</p><small>{item.confidence} confidence · {item.confidenceReason} Retrieved {item.retrievedAt}</small>
    </blockquote>)}
  </section>;
}
