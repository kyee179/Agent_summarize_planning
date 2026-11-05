const names = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export function weeklyCalendar(legacy) {
  return {
    version: 1,
    weekdays: Array.from({ length: 7 }, (_, day) =>
      legacy
        ? legacy.map((x) => ({ startsAt: x.startsAt, endsAt: x.endsAt }))
        : day === 0 || day === 6
          ? []
          : [
              { startsAt: "09:00", endsAt: "12:30" },
              { startsAt: "14:00", endsAt: "18:00" },
            ],
    ),
    exceptions: [],
  };
}
export function WorkingCalendarEditor({ value, onChange, legacy }) {
  const replaceDay = (day, intervals) =>
    onChange({
      ...value,
      weekdays: value.weekdays.map((slots, index) =>
        index === day ? intervals : slots,
      ),
    });
  function slots(items, change, label) {
    return (
      <div className="working-slots">
        {items.length === 0 && <span className="helper">Day off</span>}
        {items.map((slot, index) => (
          <div className="working-slot" key={index}>
            <label>
              From
              <input
                aria-label={`${label} start ${index + 1}`}
                type="time"
                required
                value={slot.startsAt}
                onChange={(e) =>
                  change(
                    items.map((s, i) =>
                      i === index ? { ...s, startsAt: e.target.value } : s,
                    ),
                  )
                }
              />
            </label>
            <label>
              Until
              <input
                aria-label={`${label} end ${index + 1}`}
                required
                pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00"
                value={slot.endsAt}
                onChange={(e) =>
                  change(
                    items.map((s, i) =>
                      i === index ? { ...s, endsAt: e.target.value } : s,
                    ),
                  )
                }
              />
            </label>
            <button
              type="button"
              className="text-button"
              aria-label={`Remove ${label} interval ${index + 1}`}
              onClick={() => change(items.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="text-button"
          disabled={items.length >= 16}
          onClick={() =>
            change([...items, { startsAt: "09:00", endsAt: "12:00" }])
          }
        >
          Add interval
        </button>
      </div>
    );
  }
  return (
    <section className="working-editor">
      <label className="check-row">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) =>
            onChange(e.target.checked ? weeklyCalendar(legacy) : null)
          }
        />
        Use weekly working hours and date exceptions
      </label>
      {value && (
        <>
          <p className="helper">
            Only these intervals are available for planning. Leave lunch breaks
            between intervals. Empty days stay off.
          </p>
          {value.weekdays.map((items, day) => (
            <div className="working-day" key={day}>
              <div>
                <strong>{names[day]}</strong>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    onChange({
                      ...value,
                      weekdays: value.weekdays.map((slots, index) =>
                        index > 0 && index < 6
                          ? items.map((x) => ({ ...x }))
                          : slots,
                      ),
                    })
                  }
                >
                  Copy to weekdays
                </button>
              </div>
              {slots(items, (next) => replaceDay(day, next), names[day])}
            </div>
          ))}
          <h3>Date exceptions</h3>
          {value.exceptions.map((item, index) => (
            <div className="working-day" key={index}>
              <label>
                Date
                <input
                  aria-label={`Exception date ${index + 1}`}
                  type="date"
                  required
                  value={item.date}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      exceptions: value.exceptions.map((x, i) =>
                        i === index ? { ...x, date: e.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
              {slots(
                item.intervals,
                (intervals) =>
                  onChange({
                    ...value,
                    exceptions: value.exceptions.map((x, i) =>
                      i === index ? { ...x, intervals } : x,
                    ),
                  }),
                item.date,
              )}
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  onChange({
                    ...value,
                    exceptions: value.exceptions.filter((_, i) => i !== index),
                  })
                }
              >
                Remove exception
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-button"
            onClick={() =>
              onChange({
                ...value,
                exceptions: [...value.exceptions, { date: "", intervals: [] }],
              })
            }
          >
            Add date exception
          </button>
        </>
      )}
    </section>
  );
}
