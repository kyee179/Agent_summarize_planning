const { isCalendarDate, ContractError } = require('./contracts/validate.cjs');
const bad = message => { throw new ContractError([{path:'/plan/availability',code:'working_calendar',message}]); };
const minutes = clock => clock === '24:00' ? 1440 : /^([01]\d|2[0-3]):[0-5]\d$/.test(clock) ? Number(clock.slice(0,2))*60+Number(clock.slice(3)) : NaN;
const clock = n => `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
function intervals(value) {
  if (!Array.isArray(value) || value.length > 16) bad('Choose up to 16 working intervals per day');
  const sorted=value.map(slot=>{
    if (!slot || Object.keys(slot).some(k=>!['startsAt','endsAt','label'].includes(k)) || typeof slot.startsAt !== 'string' || typeof slot.endsAt !== 'string' || !Number.isFinite(minutes(slot.startsAt)) || !Number.isFinite(minutes(slot.endsAt)) || minutes(slot.startsAt)>=minutes(slot.endsAt) || slot.startsAt==='24:00') bad('Working intervals must have a valid start before their end');
    return { startsAt:slot.startsAt, endsAt:slot.endsAt };
  }).sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
  for(let i=1;i<sorted.length;i++)if(sorted[i].startsAt<sorted[i-1].endsAt)bad('Working intervals cannot overlap');
  return sorted;
}
function validate(value) {
  if (!value || value.version!==1 || !Array.isArray(value.weekdays) || value.weekdays.length!==7 || !Array.isArray(value.exceptions) || value.exceptions.length>366) bad('Invalid weekly working calendar');
  const days=new Set();
  return {version:1,weekdays:value.weekdays.map(intervals),exceptions:value.exceptions.map(item=>{
    if(!item || !isCalendarDate(item.date) || days.has(item.date))bad('Choose unique valid dates for exceptions');
    days.add(item.date);return {date:item.date,intervals:intervals(item.intervals)};
  }).sort((a,b)=>a.date.localeCompare(b.date))};
}
function preset() { return {version:1,weekdays:Array.from({length:7},(_,day)=>day===0||day===6?[]:[{startsAt:'09:00',endsAt:'12:30'},{startsAt:'14:00',endsAt:'18:00'}]),exceptions:[]}; }
function resolve(settings,date,requested) {
  if(!isCalendarDate(date))bad('Choose a valid planning date');
  const calendar=settings.workingCalendar ? validate(settings.workingCalendar) : null;
  const available=calendar ? calendar.exceptions.find(x=>x.date===date)?.intervals ?? calendar.weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()] : intervals(settings.defaultAvailability || []);
  if(requested===undefined)return available;
  const selected=intervals(requested),result=[];
  for(const a of available)for(const b of selected){const start=Math.max(minutes(a.startsAt),minutes(b.startsAt)),end=Math.min(minutes(a.endsAt),minutes(b.endsAt));if(start<end)result.push({startsAt:clock(start),endsAt:clock(end)});}
  return result;
}
module.exports={validate,preset,resolve,intervals};
