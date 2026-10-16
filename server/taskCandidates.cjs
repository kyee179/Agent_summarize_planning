// Suggestions only. None of these values enter scheduling until explicitly confirmed.
function candidates(text, { date, timezone }) {
  let deadlineDate = /\b(\d{4}-\d{2}-\d{2})\b/u.exec(text)?.[1] || null;
  if (!deadlineDate && /明天|\btomorrow\b/iu.test(text) && /^\d{4}-\d{2}-\d{2}$/.test(date || '')) deadlineDate = new Date(Date.parse(date + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
  const time = /(?:\bat\s+|[ T]|下午|上午)([01]?\d|2[0-3]):([0-5]\d)/iu.exec(text);
  const minutes = /(\d{1,4})\s*(分钟|小時|小时|minutes?|mins?|hours?|hrs?)/iu.exec(text);
  return { deadlineDate, deadlineTime: time ? `${time[1].padStart(2, '0')}:${time[2]}` : null,
    timezone: /\bUTC\b/i.test(text) ? 'UTC' : timezone,
    effortMinutes: minutes ? Number(minutes[1]) * (/小时|小時|hours?|hrs?/i.test(minutes[2]) ? 60 : 1) : null,
    confirmation: 'required' };
}
module.exports = { candidates };
