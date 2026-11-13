import { t, useLocale } from '../i18n/index.js';
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
  useLocale();
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
        {items.length === 0 && <span className="helper">{t("Day off")}</span>}
        {items.map((slot, index) => (
          <div className="working-slot" key={index}>
            <label>{t("From ")}<input
                aria-label={t("{p0} start {p1}", {p0: t(label), p1: index + 1})}
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
            <label>{t("Until ")}<input
                aria-label={t("{p0} end {p1}", {p0: t(label), p1: index + 1})}
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
              aria-label={t("Remove {p0} interval {p1}", {p0: t(label), p1: index + 1})}
              onClick={() => change(items.filter((_, i) => i !== index))}
            >{t("Remove ")}</button>
          </div>
        ))}
        <button
          type="button"
          className="text-button"
          disabled={items.length >= 16}
          onClick={() =>
            change([...items, { startsAt: "09:00", endsAt: "12:00" }])
          }
        >{t("Add interval ")}</button>
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
        />{t("Use weekly working hours and date exceptions ")}</label>
      {value && (
        <>
          <p className="helper">{t("Only these intervals are available for planning. Leave lunch breaks between intervals. Empty days stay off. ")}</p>
          {value.weekdays.map((items, day) => (
            <div className="working-day" key={day}>
              <div>
                <strong>{t(names[day])}</strong>
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
                >{t("Copy to weekdays ")}</button>
              </div>
              {slots(items, (next) => replaceDay(day, next), names[day])}
            </div>
          ))}
          <h3>{t("Date exceptions")}</h3>
          {value.exceptions.map((item, index) => (
            <div className="working-day" key={index}>
              <label>{t("Date ")}<input
                  aria-label={t("Exception date {p0}", {p0: index + 1})}
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
              >{t("Remove exception ")}</button>
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
          >{t("Add date exception ")}</button>
        </>
      )}
    </section>
  );
}
