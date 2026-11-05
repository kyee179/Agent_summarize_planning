export function EstimateFeatures({ value, onChange }) {
  const change = (key, next) => onChange({ ...value, [key]: next });
  return (
    <details className="advanced-section">
      <summary>Work details for better estimates</summary>
      <p className="helper">
        Optional. Describe this exact work scope. Leave unknown details blank;
        only reviewed complete examples can train the later model.
      </p>
      <div className="field-grid">
        <label>
          Work type
          <select
            value={value.category || ""}
            onChange={(e) => change("category", e.target.value)}
          >
            <option value="">Unknown</option>
            {[
              "writing",
              "coding",
              "review",
              "research",
              "admin",
              "study",
              "other",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Unit, for example charts or pages
          <input
            maxLength={80}
            value={value.unit || ""}
            onChange={(e) => change("unit", e.target.value)}
          />
        </label>
        <label>
          Quantity in this scope
          <input
            type="number"
            min={1}
            max={100000}
            value={value.quantity ?? ""}
            onChange={(e) =>
              change(
                "quantity",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          />
        </label>
        <label>
          Revision or creation
          <select
            value={value.revise_or_create || ""}
            onChange={(e) => change("revise_or_create", e.target.value)}
          >
            <option value="">Unknown</option>
            <option value="revise">Revise existing work</option>
            <option value="create">Create new work</option>
            <option value="other">Other scoped work</option>
          </select>
        </label>
        <label>
          Complexity
          <select
            value={value.complexity ?? ""}
            onChange={(e) =>
              change(
                "complexity",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          >
            <option value="">Unknown</option>
            <option value={1}>1 · Routine, inputs ready</option>
            <option value={2}>2 · Several decisions or revisions</option>
            <option value={3}>
              3 · New approach or substantial uncertainty
            </option>
          </select>
        </label>
        <label>
          Your familiarity
          <select
            value={value.familiarity ?? ""}
            onChange={(e) =>
              change(
                "familiarity",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          >
            <option value="">Unknown</option>
            <option value={1}>1 · New to this work</option>
            <option value={2}>2 · Some experience</option>
            <option value={3}>3 · Frequently do this</option>
          </select>
        </label>
      </div>
    </details>
  );
}
