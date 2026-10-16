// Offsets are UTF-16 indices, so content.slice(start, end) reproduces each excerpt.
function chunks(content, size = 4000) {
  const text = String(content || ''), result = [];
  for (const match of text.matchAll(/[^\n.!?。！？]+/gu)) {
    const leading = match[0].length - match[0].trimStart().length;
    const end = match.index + match[0].trimEnd().length;
    for (let start = match.index + leading; start < end;) {
      let next = Math.min(end, start + size);
      if (next < end && /[\uD800-\uDBFF]/.test(text[next - 1])) --next;
      result.push({ start, end: next, excerpt: text.slice(start, next) });
      start = next;
    }
  }
  return result;
}

function coverage(input, evidence) {
  const seen = new Set();
  const sources = [input.journal, ...(input.relatedJournals || [])].filter(Boolean).flatMap((source, index) => {
    const sourceId = source.id || `input-journal-${index}`;
    if (seen.has(sourceId)) return [];
    seen.add(sourceId);
    const all = chunks(source.content);
    const included = new Set(evidence.filter(e => e.sourceId === sourceId && e.sourceType === 'journal').map(e => e.id));
    const spans = all.flatMap((span, i) => included.has(`e:${index}:${i}`) ? [{ evidenceId: `e:${index}:${i}`, start: span.start, end: span.end }] : []);
    const totalCharacters = all.reduce((n, span) => n + span.end - span.start, 0);
    const includedCharacters = spans.reduce((n, span) => n + span.end - span.start, 0);
    return [{ sourceId, totalCharacters, includedCharacters, omittedCharacters: totalCharacters - includedCharacters, spans }];
  });
  return { version: 1, offsetUnit: 'UTF-16', partial: sources.some(s => s.omittedCharacters > 0), sources };
}
module.exports = { chunks, coverage };
