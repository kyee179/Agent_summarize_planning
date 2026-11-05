const {isAction,explicitNonAction}=require('./language.cjs');
const {localParts,nextDate}=require('./contracts/time.cjs');
const {isCalendarDate}=require('./contracts/validate.cjs');
function localCandidates(source){return source.text.split(/\n|(?<=[.!?。！？])\s*/u).map(text=>text.trim()).filter(text=>text&&!text.startsWith('>')&&!explicitNonAction(text)&&!/(?:\b(?:already done|already sent|completed|cancelled|canceled|ignore the previous|someone|anyone)\b|已完成|已取消)/iu.test(text)&&(isAction(text)||/^(?:please|can you|could you|would you|请你|麻烦你)\s*/iu.test(text))).slice(0,20).map(quote=>({title:quote.slice(0,500),quote,minutes:null,scope:'next_session'}));}
function candidates(text,source,timezone){
  const date=localParts(Date.parse(source.sourceTimestamp||source.observedAt),timezone).date;
  const result=require('./taskCandidates.cjs').candidates(text,{date,timezone});
  if(result.deadlineDate)return result;
  const dates=[...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map(m=>m[1]).filter(isCalendarDate);
  if(/\btomorrow\b/i.test(text))dates.push(nextDate(date));else if(/\btoday\b/i.test(text))dates.push(date);
  const days=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const mentioned=days.filter(day=>new RegExp('\\b'+day+'\\b','i').test(text));
  if(mentioned.length===1){const offset=(days.indexOf(mentioned[0])-new Date(date+'T00:00:00Z').getUTCDay()+7)%7;let target=date;for(let i=0;i<offset;i++)target=nextDate(target);dates.push(target);result.ambiguities.push('Check which occurrence of the named weekday the source means.');}
  const unique=[...new Set(dates)];if(unique.length===1)result.deadlineDate=unique[0];else if(unique.length>1)result.ambiguities.push('Several source dates need review.');
  const times=[...text.matchAll(/\b([01]\d|2[0-3]):([0-5]\d)\b/g)];if(times.length===1)result.deadlineTime=times[0][1]+':'+times[0][2];
  return result;
}
module.exports={localCandidates,candidates};
