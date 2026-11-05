const { createGmail } = require("./integrations/gmail.cjs");
const { createWorkCapture } = require("./integrations/workCapture.cjs");
const { localParts } = require("./contracts/time.cjs");
const { localCandidates } = require("./sourceExtraction.cjs");
function mount(
  app,
  store,
  { clock, analyze, providerEnv, integrationOptions },
) {
  const gmail = createGmail(store, { ...integrationOptions, clock }),
    capture = createWorkCapture(store, { ...integrationOptions, clock });
  const close = app.locals.closeIntegrations;
  app.locals.closeIntegrations = () => {
    capture.close();
    gmail.close();
    close();
  };
  app.get("/api/task-sources", (_req, res) =>
    res.json({
      sources: store.listSources(),
      candidates: store.listCandidates(),
      gmail: gmail.status(),
      capture: capture.status(),
    }),
  );
  app.post("/api/task-sources", (req, res) => {
    if (req.body.consent !== true)
      return res
        .status(400)
        .json({ error: "Allow selected source content to be stored locally" });
    res.status(201).json(store.importTaskSource(req.body, clock()));
  });
  app.delete("/api/task-sources/:id", (req, res) =>
    res.json(store.revokeTaskSource(req.params.id)),
  );
  app.post("/api/task-sources/:id/discover", async (req, res) => {
    const source = store.getSource(req.params.id);
    if (!source || source.revoked)
      return res.status(404).json({ error: "Source unavailable" });
    const settings = store.getSettings(),
      today = localParts(Date.parse(clock()), settings.timezone).date;
    let proposals;
    if (req.body.allowAI === true) {
      const release = req.profileSession?.startAnalysis(settings) || (() => {});
      try {
        // Reuse the bounded interpretation engine; this adapter creates no persistent diary.
        const result = await analyze({
          discovery: true,
          journal: {
            id: source.id,
            type: "daily",
            title: source.title,
            content: source.text,
            journalDate: localParts(
              Date.parse(source.sourceTimestamp || source.observedAt),
              settings.timezone,
            ).date,
            updatedAt: source.version,
          },
          relatedJournals: [],
          settings,
          env: providerEnv,
          signal: req.profileSession?.signal,
          targetDate: today,
          availability: [],
          notBefore: clock(),
        });
        req.profileSession?.assertCurrent();
        const evidence = new Map(
          result.contract.evidence.map((e) => [e.id, e]),
        );
        proposals = result.contract.tasks
          .map((task) => ({
            title: task.title,
            quote: task.evidenceIds
              .map((id) => evidence.get(id)?.excerpt)
              .find((text) => text && source.text.includes(text)),
            minutes:
              result.contract.estimates.find((e) => e.id === task.estimateId)
                ?.effortMinutes?.expected || null,
            scope: result.contract.estimates.find(
              (e) => e.id === task.estimateId,
            )?.scope,
          }))
          .filter((x) => x.quote);
      } finally {
        release();
      }
    } else {
      proposals = localCandidates(source);
    }
    res.json({
      candidates: store.saveTaskDiscovery(source.id, source.version, proposals),
      mode: req.body.allowAI === true ? "authorized_ai" : "local_rules",
      coverage: "Selected captured text only; ownership and facts need review.",
    });
  });
  app.post("/api/task-candidates/:id/review", (req, res) =>
    res.json(store.reviewCandidate(req.params.id, req.body)),
  );
  app.post("/api/task-plans", (req, res) =>
    res.status(201).json(store.prepareTaskPlan(req.body, clock())),
  );
  app.get("/api/task-plans/:id", (req, res) => {
    const plan = store.getSourcePlan(req.params.id);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    res.json(plan);
  });
  app.post("/api/task-plans/:id/apply", (req, res) =>
    res.json(store.applyTaskPlan(req.params.id, clock())),
  );
  app.post("/api/tasks/:id/effort", (req, res) =>
    res
      .status(201)
      .json(store.recordTaskEffort(req.params.id, req.body, clock())),
  );
  app.post("/api/gmail/connect", async (req, res) =>
    res.json(await gmail.connect(req.body)),
  );
  app.post("/api/gmail/cancel", (_req, res) => {
    gmail.cancel();
    res.json({ cancelled: true });
  });
  app.post("/api/gmail/sync", async (req, res) =>
    res.json(await gmail.sync(req.body)),
  );
  app.delete("/api/gmail", async (_req, res) =>
    res.json(await gmail.disconnect()),
  );
  app.post("/api/work-capture/windows", async (req, res) =>
    res.json(await capture.windows(req.body)),
  );
  app.post("/api/work-capture/start", async (req, res) =>
    res.json(await capture.start(req.body)),
  );
  app.post("/api/work-capture/stop", (_req, res) => res.json(capture.stop()));
  app.post("/api/journals/:id/replan", (req, res) => {
    const current = store.getJournalAnalysis(req.params.id);
    if (!current || current.id !== req.body.analysisId)
      return res
        .status(409)
        .json({ error: "Analysis changed; reload before replanning" });
    const { scheduleAnalysis } = require("./scheduler.cjs"),
      { planningRange } = require("./scheduler.cjs");
    const base = {
      ...current,
      id: require("node:crypto").randomUUID(),
      createdAt: clock(),
    };
    delete base.taskRevisions;
    const options = {
      settings: store.getSettings(),
      events: store.listPlanningEvents(planningRange(base.contract.plan)),
      notBefore: new Date(
        Date.parse(clock()) +
          (store.getSettings().planningLeadMinutes || 5) * 60000,
      ).toISOString(),
      availabilitySource: current.scheduling?.availabilitySource || "settings",
    };
    const result = scheduleAnalysis(base, options);
    res.json(store.saveJournalAnalysis(result));
  });
}
module.exports = { mount };
