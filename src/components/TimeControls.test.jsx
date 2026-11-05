import {useState} from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,expect,test} from 'vitest';
import {DurationControl} from './DurationControl.jsx';
import {WorkingCalendarEditor,weeklyCalendar} from './WorkingCalendarEditor.jsx';
afterEach(cleanup);
test('exact duration and slider stay synchronized for off-step values',()=>{function Fixture(){const [value,setValue]=useState('60');return <DurationControl value={value} onChange={setValue}/>;}render(<Fixture/>);fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'17'}});expect(screen.getByRole('slider').value).toBe('17');fireEvent.change(screen.getByRole('slider'),{target:{value:'90'}});expect(screen.getByRole('spinbutton').value).toBe('90');});
test('weekly editor preserves all legacy intervals on adoption',()=>{const legacy=[{startsAt:'10:00',endsAt:'12:00'},{startsAt:'14:00',endsAt:'18:00'}];function Fixture(){const [value,setValue]=useState(null);return <WorkingCalendarEditor value={value} legacy={legacy} onChange={setValue}/>;}render(<Fixture/>);fireEvent.click(screen.getByRole('checkbox'));expect(screen.getByLabelText('Monday start 2').value).toBe('14:00');expect(screen.getByLabelText('Sunday start 1').value).toBe('10:00');});
test('new-profile preset has lunch gap and weekends off',()=>{const value=weeklyCalendar();expect(value.weekdays[0]).toEqual([]);expect(value.weekdays[1]).toEqual([{startsAt:'09:00',endsAt:'12:30'},{startsAt:'14:00',endsAt:'18:00'}]);});
