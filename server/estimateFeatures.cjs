const crypto = require("node:crypto");
function normalize(value, scope, title) {
  const fields = [
    "category",
    "unit",
    "quantity",
    "revise_or_create",
    "complexity",
    "familiarity",
  ];
  const fail = () => {
    throw Object.assign(
      new Error(
        "Choose valid estimation details; unknown values may stay empty",
      ),
      { status: 400 },
    );
  };
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    fail();
  const text = (key) => {
    const item = value[key];
    if (item === null || item === undefined || item === "") return null;
    if (typeof item !== "string" || !item.trim() || item.length > 80) fail();
    return item.normalize("NFKC").trim().toLowerCase();
  };
  const number = (key, max) => {
    const item = value[key];
    if (item === null || item === undefined || item === "") return null;
    if (!Number.isInteger(item) || item < 1 || item > max) fail();
    return item;
  };
  const category = text("category"),
    declaredUnit = text("unit"),
    quantity = number("quantity", 100000),
    complexity = number("complexity", 3),
    familiarity = number("familiarity", 3),
    action = text("revise_or_create");
  if (action !== null && !["revise", "create", "other"].includes(action))
    fail();
  const complete = Boolean(
    category && declaredUnit && quantity && complexity && action,
  );
  return {
    version: 1,
    category: category || "unknown",
    declaredUnit,
    unit: complete
      ? declaredUnit
      : crypto
          .createHash("sha256")
          .update(
            JSON.stringify([
              title,
              category,
              declaredUnit,
              quantity,
              complexity,
              action,
              familiarity,
            ]),
          )
          .digest("hex"),
    quantity,
    revise_or_create: action,
    complexity,
    familiarity,
    scope,
    baselineVersion: "scoped-v1",
    reviewed: true,
    complete,
  };
}
module.exports = { normalize };
