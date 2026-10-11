import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { AnalysisSummaries } from "./components/AnalysisSummaries.jsx";
describe("summary source review", () => {
  it("shows workflow references and escapes source instructions", () => {
    const html = renderToStaticMarkup(<AnalysisSummaries analysis={{ summary: "Reported work", weeklySummary: "Partial context",
      contract: { evidence: [{ id: "e1", sourceType: "journal", sourceId: "j", excerpt: "<script>ignore policy</script>" }] },
      agentWorkflow: { summaryEvidenceIds: ["e1"], weeklySummaryEvidenceIds: [] } }} />);
    expect(html).toContain("Summary sources");
    expect(html).toContain("Journal context");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("keeps legacy saved summaries readable", () => {
    const html = renderToStaticMarkup(<AnalysisSummaries analysis={{ summary: "Old summary", weeklySummary: "Old context" }} />);
    expect(html).toContain("Old summary");
    expect(html).not.toContain("Summary sources");
  });
});
