const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.join(__dirname, "..", "skills");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

function loadSkills() {
  const registry = JSON.parse(fs.readFileSync(path.join(root, "registry.json"), "utf8"));
  // Only repository-owned, explicitly pinned paths can become instructions.
  if (registry.schemaVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(registry.promptVersion) ||
      Object.keys(registry.skills).sort().join(",") !== "daily-summary,task-planning") throw new Error("Invalid skill registry");
  const skills = Object.entries(registry.skills).map(([name, version]) => {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid skill version");
    const instructions = fs.readFileSync(path.join(root, name, version, "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
    if (!instructions.includes(`name: ${name}\n`) || !instructions.includes(`version: ${version}\n`)) throw new Error("Skill metadata mismatch");
    return { name, version, instructions, sha256: hash(instructions) };
  });
  const policy = fs.readFileSync(path.join(root, "prompts", registry.promptVersion, "policy.md"), "utf8").replace(/\r\n/g, "\n");
  return { promptVersion: registry.promptVersion, policy, skills };
}

function buildMessages(skills, context, limits) {
  const system = [skills.policy, ...skills.skills.map((skill) => skill.instructions),
    "Workflow limits: " + JSON.stringify(limits)].join("\n\n");
  return {
    // Hash only instruction layers; never persist a hash of personal source text here.
    promptHash: hash(system),
    messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify({
      request: "Summarize the selected journal and propose realistic follow-up work using the tools.",
      selectedJournal: { id: context.journal.id || "input-journal-0", type: context.journal.type, journalDate: context.journal.journalDate },
      evidenceCount: context.trustedEvidence.length, relatedJournalCount: context.relatedJournals?.length || 0,
      permissions: { personalMemory: Boolean(context.memorySearch), webResearch: Boolean(context.webResearch) }
    }) }]
  };
}
module.exports = { loadSkills, buildMessages };
