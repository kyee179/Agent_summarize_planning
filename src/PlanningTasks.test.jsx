import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { PlanningTasks } from "./components/PlanningTasks.jsx";
const require = createRequire(import.meta.url);
const { localRuleBasedAnalysis } = require("../server/journalAnalyzer.cjs");
describe("planning review", () => {
  it("shows unknown deadlines, tentative ranges, source excerpts, and unscheduled work", () => {
    const analysis = localRuleBasedAnalysis({ journal: { id: "j", journalDate: "2026-10-11", content: "I need to finish the project." }, availability: [] });
    const html = renderToStaticMarkup(<PlanningTasks analysis={analysis} />);
    expect(html).toContain("Deadline unknown");
    expect(html).toContain("90 min expected (45–180 min range)");
    expect(html).toContain("local heuristic");
    expect(html).toContain("source matched");
    expect(html).toContain("Unscheduled work");
    expect(html).toContain("Confirm the remaining work");
  });
  it("keeps legacy saved analysis readable", () => {
    const html = renderToStaticMarkup(<PlanningTasks analysis={{ tasks: [{ title: "Old draft", priority: "low", estimatedMinutes: 30 }] }} />);
    expect(html).toContain("Analyze again");
    expect(html).toContain("Old draft");
  });
});
