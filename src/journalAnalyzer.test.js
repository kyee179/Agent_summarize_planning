import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { localRuleBasedAnalysis, splitSentences } = require("../server/journalAnalyzer.cjs");

describe("journal analyzer", () => {
  it("splits journal text into planning sentences", () => {
    expect(splitSentences("I sent 50 CVs. Need to finish one assessment tonight.")).toHaveLength(2);
  });

  it("extracts tasks and schedule drafts from local fallback", () => {
    const analysis = localRuleBasedAnalysis({
      journal: {
        type: "daily",
        journalDate: "2026-07-13",
        content: "I finished one test today. I should do the project tonight. For dissertation, maybe it is time to do the experiment first."
      },
      availability: [{ startsAt: "20:00", endsAt: "24:00" }]
    });

    expect(analysis.tasks.length).toBeGreaterThanOrEqual(2);
    expect(analysis.scheduleDrafts.length).toBeGreaterThan(0);
    expect(analysis.scheduleDrafts[0]).toHaveProperty("startsAt");
  });
});