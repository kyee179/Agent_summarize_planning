const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
function terms(text) {
  const normalized = String(text).normalize('NFKC').toLowerCase();
  const result = [...normalized.matchAll(/[\p{L}\p{N}]+/gu)].map(m => m[0]);
  for (const item of segmenter.segment(normalized)) if (item.isWordLike) result.push(item.segment);
  for (const match of normalized.matchAll(/\p{Script=Han}+/gu)) {
    const chars = [...match[0]];
    for (let i = 0; i < chars.length; i++) {
      result.push(chars[i]);
      if (i + 1 < chars.length) result.push(chars[i] + chars[i + 1]);
    }
  }
  return [...new Set(result)];
}
module.exports = { terms, indexedText: text => terms(text).join(' ') };
