const words = new Intl.Segmenter('en', { granularity: 'word' });
const graphemes = new Intl.Segmenter('zh', { granularity: 'grapheme' });
export function textCount(text) {
  if (/\p{Script=Han}/u.test(text)) return { count:[...graphemes.segment(text)].filter(item=>!/^\s+$/u.test(item.segment)).length, unit:'characters' };
  return { count:[...words.segment(text)].filter(item=>item.isWordLike).length, unit:'words' };
}
