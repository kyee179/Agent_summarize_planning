const { isCalendarDate, isTimezone, isInstant } = require('./contracts/validate.cjs');
const { wallClockCandidates } = require('./contracts/time.cjs');
const { normalize } = require('./language.cjs');
const digits = { 零:0, 〇:0, 一:1, 二:2, 两:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9 };
function number(text) {
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (text === '半') return 0.5;
  if (/^[零〇一二两三四五六七八九]+$/.test(text)) return Number([...text].map(c=>digits[c]).join(''));
  if (/^[一二两三四五六七八九]?十[零一二三四五六七八九]?$/.test(text)) { const [a,b] = text.split('十'); return (a ? digits[a] : 1)*10 + (b ? digits[b] : 0); }
  return NaN;
}
const shift = (date, days) => new Date(Date.parse(date+'T12:00:00Z') + days*86400000).toISOString().slice(0,10);
function candidates(original, { date, timezone }) {
  const text = normalize(original), ambiguities = [], dates = [], times = [];
  const explicit = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})/u)?.[0];
  const offset = explicit?.match(/Z|[+-]\d{2}:\d{2}$/u)?.[0];
  const zone = offset ? offset === 'Z' ? 'UTC' : `UTC${offset}` : /\bUTC\b/i.test(text) ? 'UTC' : timezone;
  for (const m of text.matchAll(/(?<!\d)(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})(?:日|号)?(?!\d)/gu)) {
    const value = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    if (isCalendarDate(value)) dates.push(value); else ambiguities.push('Invalid calendar date in source.');
  }
  if (isCalendarDate(date)) {
    for (const m of text.matchAll(/大后天|后天|明天|今天|次日|\btomorrow\b/giu)) dates.push(shift(date, /大后天/u.test(m[0]) ? 3 : /后天/u.test(m[0]) ? 2 : /明天|次日|tomorrow/iu.test(m[0]) ? 1 : 0));
    for (const m of text.matchAll(/([\d零〇一二两三四五六七八九十]+)天后/gu)) { const n=number(m[1]); if(Number.isInteger(n)&&n>=0&&n<=366) dates.push(shift(date,n)); }
    for (const m of text.matchAll(/(下下|下一|下|本|这)(?:周|星期|礼拜)([一二三四五六日天])/gu)) {
      const weekday = new Date(date+'T12:00:00Z').getUTCDay(), monday = shift(date, -((weekday+6)%7));
      const week = m[1] === '下下' ? 2 : /下/u.test(m[1]) ? 1 : 0;
      const day = {一:0,二:1,三:2,四:3,五:4,六:5,日:6,天:6}[m[2]];
      dates.push(shift(monday,week*7+day));
    }
  } else if (/明天|后天|下周|天后/u.test(text)) ambiguities.push('Relative dates require a valid source journal date.');
  if (!dates.length && /(?:周|星期|礼拜)[一二三四五六日天]/u.test(text)) ambiguities.push('Specify which week.');
  for (const m of text.matchAll(/(?<!\d)(上午|下午|晚上|中午|凌晨)?([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?/gu)) {
    if (/[+-]$/u.test(text.slice(0,m.index))) continue; // An ISO/UTC offset is not a second source clock.
    let hour=Number(m[2]); if (/下午|晚上/u.test(m[1] || '') && hour>=1 && hour<=11) hour+=12;
    if (/凌晨/u.test(m[1] || '') && hour===12) hour=0;
    if (m[1] === '中午' && hour>=1 && hour<=2) hour+=12;
    times.push(`${String(hour).padStart(2,'0')}:${m[3]}`);
  }
  for (const m of text.matchAll(/(上午|下午|晚上|中午|凌晨|早上)?([\d零〇一二两三四五六七八九十]{1,3})(?:点|时)(半|一刻|三刻|[\d零〇一二两三四五六七八九十]+分?)?/gu)) {
    let hour=number(m[2]), minute = m[3] === '半' ? 30 : m[3] === '一刻' ? 15 : m[3] === '三刻' ? 45 : m[3] ? number(m[3].replace(/分$/u,'')) : 0;
    if (/下午|晚上/u.test(m[1] || '') && hour>=1 && hour<=11) hour+=12;
    if (/凌晨/u.test(m[1] || '') && hour===12) hour=0;
    if (m[1] === '中午' && hour>=1 && hour<=2) hour+=12;
    if ((!m[1] && hour>=1 && hour<=12) || /上午|早上|晚上/u.test(m[1] || '') && hour===12) { ambiguities.push('Specify morning, afternoon or an unambiguous 24-hour time.'); continue; }
    if(hour>=0&&hour<24&&minute>=0&&minute<60) times.push(`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`); else ambiguities.push('Invalid clock time in source.');
  }
  let effortMinutes = null;
  if (!/(?:不需要|无需|不是|取消)/u.test(text)) {
    const durations = [...text.matchAll(/([\d零〇一二两三四五六七八九十半.]+)(个半|个)?\s*(小时|小時|分钟|分鐘|minutes?|mins?|hours?|hrs?)(?!后|前|内)/giu)];
    if (durations.length) {
      let total=0;
      for(const m of durations) { const n=number(m[1]); total+=(n+(m[2]==='个半'?0.5:0)) * (/小时|小時|hours?|hrs?/iu.test(m[3])?60:1); }
      if(Number.isInteger(total)&&total>0&&total<=525600&&!/[\d一二三四五六七八九十]\s*(?:[-–~到至])\s*[\d一二三四五六七八九十]/u.test(text)) effortMinutes=total;
    }
  }
  const uniqueDates=[...new Set(dates)], uniqueTimes=[...new Set(times)];
  if(uniqueDates.length>1) ambiguities.push('Multiple source dates need confirmation.');
  if(uniqueTimes.length>1) ambiguities.push('Multiple source times need confirmation.');
  const deadlineDate=uniqueDates.length===1?uniqueDates[0]:null, deadlineTime=uniqueTimes.length===1?uniqueTimes[0]:null;
  let deadlineInstant=null;
  if(explicit && isInstant(explicit)) deadlineInstant=new Date(explicit).toISOString();
  else if(deadlineDate&&deadlineTime&&isTimezone(zone)) {
    const matches=wallClockCandidates(deadlineDate,deadlineTime,zone);
    if(matches.length===1) deadlineInstant=new Date(matches[0]).toISOString(); else ambiguities.push('Source clock is skipped or repeated by a timezone change.');
  }
  if (ambiguities.length) deadlineInstant = null;
  return { version:2, deadlineDate, deadlineTime, deadlineInstant, timezone:zone, period:/下午/u.test(text)?'afternoon':/上午|早上/u.test(text)?'morning':/晚上/u.test(text)?'evening':null,
    effortMinutes, ambiguities, sourceDate:date || null, confirmation:'required' };
}
module.exports = { number, candidates };
