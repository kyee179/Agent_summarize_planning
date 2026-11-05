const normalize = text => String(text || '').normalize('NFKC');
function outputLanguage(text, requested = 'auto') {
  if (requested === 'zh-CN' || requested === 'en') return requested;
  const source = normalize(text), han = (source.match(/\p{Script=Han}/gu) || []).length;
  const latin = (source.match(/[a-z]/gi) || []).length;
  return han > 0 && han * 2 >= latin ? 'zh-CN' : 'en';
}

// Keep original UTF-16 offsets and punctuation; decimal points are not sentence endings.
function sentenceSpans(text) {
  text = String(text || ''); const result = []; let start = 0;
  const add = end => { let a = start, b = end; while (a < b && /\s/u.test(text[a])) a++; while (b > a && /\s/u.test(text[b - 1])) b--; if (a < b) result.push({ start:a, end:b }); };
  for (let i=0;i<text.length;i++) {
    const c = text[i], decimal = /[0-9０-９]/u.test(text[i-1] || '') && /[0-9０-９]/u.test(text[i+1] || '');
    if (/[\n!?。！？;；]/u.test(c) || ((c === '.' || c === '．') && !decimal)) { add(i); start=i+1; }
  }
  add(text.length); return result;
}
function actionClauses(text) {
  // Conditional obligations are not established tasks in the conservative offline baseline.
  if (/(?:如果|假如|除非|要是)|\b(?:if|unless)\b/iu.test(normalize(text))) return [];
  return String(text).split(/[，,；;\n]+|(?:但是|不过|然而|但)(?=还|仍|我|需要|明|下|后|准备|必须)/u)
    .map(s=>s.trim().replace(/^(?:但|但是|不过|然而|then|but)\s*/iu,'')).filter(Boolean);
}
function isAction(text) {
  const value = normalize(text).trim();
  if (/忽略.{0,12}指令|系统提示词|write_calendar|\bignore.{0,20}instructions\b/iu.test(value)) return false;
  if (/可能|也许|或许|不确定|要不要|是否|考虑一下|\b(?:might|maybe|perhaps)\b/iu.test(value) && !/maybe (?:it'?s|it is) time/iu.test(value)) return false;
  if (/(?:不需要|不用|不必|无需|不要|不想|不打算|不准备|不计划|别再|取消|暂缓|放弃)|\b(?:should not|must not|do not|don't|no longer need to|not going to|cancelled|canceled)\b/iu.test(value)) return false;
  if (/(?:已(?:经)?(?:完成|提交|做完|取消|准备好)|(?:完成|提交|准备|更新|修复|整理|参加|处理)了|做完了|准备好了)|\b(?:already completed|already finished)\b/iu.test(value)) return false;
  return /(?:需要|必须|应该|待完成|未完成|尚未|还没|还得|计划|打算|准备(?!了|好)|记得|接下来|我要|我们要|明天要|待办[:：]?|请(?:完成|提交|准备|更新|检查|修复))|\b(?:need to|should|have to|must|not finished|unfinished|remaining|i will|we will|plan to|intend to|maybe (?:it'?s|it is) time|todo)\b/iu.test(value);
}
function actionKey(text) {
  return normalize(text).toLowerCase().replace(/^(?:(?:我(?:们)?|i|we)\s*)?(?:需要|应该|必须|打算|计划|要|need to|should|have to|must|will|plan to)\s*/iu,'').replace(/[\p{P}\p{Z}\s]+/gu,'').trim();
}
function explicitNonAction(text) {
  const value = normalize(text);
  return /不需要|无需|不用|不要|不想|不打算|取消|已(?:经)?(?:完成|提交|做完|准备好)|(?:完成|提交|准备|更新|修复|整理|参加|处理)了|如果|假如|除非|可能|也许|或许/u.test(value) && !actionClauses(value).some(isAction);
}
module.exports = { normalize, outputLanguage, sentenceSpans, actionClauses, isAction, actionKey, explicitNonAction };
