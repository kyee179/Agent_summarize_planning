export function DurationControl({
  value,
  onChange,
  label = "Planning duration in minutes",
  disabled = false,
}) {
  const minutes = Number(value) || 0;
  return (
    <div className="duration-control">
      <label>
        {label}
        <input
          type="number"
          min={1}
          max={525600}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <input
        aria-label="Adjust planning duration"
        type="range"
        min={minutes > 0 && minutes < 15 ? 1 : 15}
        max={Math.max(240, Math.ceil(minutes / 15) * 15)}
        step={minutes % 15 ? 1 : 15}
        value={minutes || 15}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="helper">
        {minutes ? `${minutes} minutes selected` : "Duration unknown"} ·
        Adjusting a plan does not measure actual effort.
      </span>
    </div>
  );
}
