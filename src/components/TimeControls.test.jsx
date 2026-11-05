import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { DurationControl } from "./DurationControl.jsx";
import { TaskFacts } from "./TaskFacts.jsx";
import {
  WorkingCalendarEditor,
  weeklyCalendar,
} from "./WorkingCalendarEditor.jsx";
afterEach(cleanup);
test('reviewing an automatic estimate preserves its total-work scope',()=>{render(<TaskFacts task={{id:'task',importance:{level:'medium'},dependsOn:[]}} record={{title:'Invented charts',status:'open',confirmed:{},scope:'remaining_task',baseline:240,sessionEventIds:[]}} tasks={[]} timezone="UTC" onClose={()=>{}} onSaved={()=>{}}/>);expect(screen.getByLabelText('Effort covers').value).toBe('remaining_task');expect(screen.getByRole('checkbox',{name:'Use the history-informed estimate instead of fixing a selected duration'}).checked).toBe(true);});
test("exact duration and slider stay synchronized for off-step values", () => {
  function Fixture() {
    const [value, setValue] = useState("60");
    return <DurationControl value={value} onChange={setValue} />;
  }
  render(<Fixture />);
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "17" } });
  expect(screen.getByRole("slider").value).toBe("17");
  fireEvent.change(screen.getByRole("slider"), { target: { value: "90" } });
  expect(screen.getByRole("spinbutton").value).toBe("90");
});
test("weekly editor preserves all legacy intervals on adoption", () => {
  const legacy = [
    { startsAt: "10:00", endsAt: "12:00" },
    { startsAt: "14:00", endsAt: "18:00" },
  ];
  function Fixture() {
    const [value, setValue] = useState(null);
    return (
      <WorkingCalendarEditor
        value={value}
        legacy={legacy}
        onChange={setValue}
      />
    );
  }
  render(<Fixture />);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByLabelText("Monday start 2").value).toBe("14:00");
  expect(screen.getByLabelText("Sunday start 1").value).toBe("10:00");
});
test("new-profile preset has lunch gap and weekends off", () => {
  const value = weeklyCalendar();
  expect(value.weekdays[0]).toEqual([]);
  expect(value.weekdays[1]).toEqual([
    { startsAt: "09:00", endsAt: "12:30" },
    { startsAt: "14:00", endsAt: "18:00" },
  ]);
});
