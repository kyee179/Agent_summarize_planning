const crypto = require("node:crypto");
const { assertBundle, isInstant } = require("./contracts/validate.cjs");
const { scheduleBundle, planningRange } = require("./scheduler.cjs");
const { estimate } = require("./effortEstimator.cjs");
const hash = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const parsed = (row) => (row ? JSON.parse(row.data) : null);
function attach(db, transaction, profile, getStore) {
  const rows = (table) =>
    db.prepare(`SELECT data FROM ${table}`).all().map(parsed);
  const source = (id) =>
    parsed(
      db
        .prepare("SELECT data FROM source_items WHERE id=? AND profile_id=?")
        .get(id, profile),
    );
  const task = (id) =>
    parsed(
      db
        .prepare("SELECT data FROM durable_tasks WHERE id=? AND profile_id=?")
        .get(id, profile),
    );
  const candidate = (id) =>
    parsed(
      db
        .prepare("SELECT data FROM task_candidates WHERE id=? AND profile_id=?")
        .get(id, profile),
    );
  const saveCandidate = (item) =>
    db
      .prepare(
        "INSERT INTO task_candidates VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(item.id, profile, item.sourceId, JSON.stringify(item));
  const savePlan = (item) =>
    db
      .prepare(
        "INSERT INTO task_plans VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(item.id, profile, JSON.stringify(item));
  const getPlan = (id) =>
    parsed(
      db
        .prepare("SELECT data FROM task_plans WHERE id=? AND profile_id=?")
        .get(id, profile),
    );
  function putSource(input, now = new Date().toISOString()) {
    if (
      !input ||
      !["email", "work_app", "document"].includes(input.kind) ||
      typeof input.externalId !== "string" ||
      !input.externalId.trim() ||
      input.externalId.length > 500 ||
      typeof input.text !== "string" ||
      !input.text.trim() ||
      input.text.length > 40000 ||
      !isInstant(now)
    )
      fail("Choose a source ID and 1–40000 characters of source text");
    if (input.sourceTimestamp && !isInstant(input.sourceTimestamp))
      fail("Source timestamp must include a timezone");
    let locator = null;
    if (input.locator) {
      try {
        const u = new URL(input.locator);
        if (
          !["http:", "https:"].includes(u.protocol) ||
          u.username ||
          u.password
        )
          throw Error();
        locator = u.href;
      } catch {
        fail("Source link must be HTTP or HTTPS");
      }
    }
    const id =
      "source:" +
      hash([
        profile,
        input.kind,
        input.accountKey || "selected",
        input.externalId,
      ]).slice(0, 40);
    const current = source(id),
      item = {
        id,
        kind: input.kind,
        externalId: input.externalId,
        accountKey: input.accountKey || null,
        title: String(input.title || "Selected source").slice(0, 500),
        text: input.text,
        locator,
        sourceTimestamp: input.sourceTimestamp || null,
        observedAt: now,
        version: hash([
          input.text,
          input.sourceTimestamp,
          locator,
          input.title,
        ]),
        revoked: false,
      };
    if (current?.version === item.version && !current.revoked) return current;
    db.prepare(
      "INSERT INTO source_items VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
    ).run(id, profile, JSON.stringify(item));
    if (current && current.version !== item.version)
      for (const entry of rows("task_candidates").filter(
        (c) => c.sourceId === id && c.state === "accepted",
      ))
        saveCandidate({
          ...entry,
          state: "needs_review",
          revision: entry.revision + 1,
        });
    return item;
  }
  function assertMailFresh(item, now) {
    if (item.kind !== "email" || !item.accountKey) return;
    const store = getStore(),
      sync = store.integrationState("gmailSync");
    if (
      store.integrationState("gmailConnection")?.id !== item.accountKey ||
      !sync?.syncedAt ||
      Date.parse(sync.syncedAt) < Date.parse(now) - 30 * 60000
    )
      fail("Refresh Gmail before planning or applying these mail tasks", 409);
  }
  function removeContent(id) {
    const item = source(id);
    if (!item) return;
    db.prepare(
      "UPDATE source_items SET data=? WHERE id=? AND profile_id=?",
    ).run(
      JSON.stringify({
        ...item,
        text: "",
        revoked: true,
        version: crypto.randomUUID(),
      }),
      id,
      profile,
    );
    for (const c of rows("task_candidates").filter((c) => c.sourceId === id))
      saveCandidate({
        ...c,
        quote: "[Source content removed]",
        deadlineSuggestion: null,
        state: "dismissed",
        revision: c.revision + 1,
      });
    for (const plan of rows("task_plans").filter((p) =>
      p.sourceSnapshots.some((s) => s.id === id),
    )) {
      plan.contract.evidence = plan.contract.evidence.map((e) =>
        e.sourceId === id ? { ...e, excerpt: "[Source content removed]" } : e,
      );
      savePlan(plan);
    }
  }
  return {
    getSource: source,
    getSourcePlan: getPlan,
    saveMailTokens(encrypted, id, previous) {
      return transaction(() => {
        const existing = parsed(
          db
            .prepare(
              "SELECT data FROM integration_state WHERE id='gmailTokens'",
            )
            .get(),
        );
        if (previous && hash(existing) !== hash(previous))
          fail("Mail connection changed", 409);
        db.prepare(
          "INSERT INTO integration_state VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        ).run("gmailTokens", JSON.stringify(encrypted));
        if (id) {
          const old = getStore().integrationState("gmailConnection")?.id;
          if (old && old !== id)
            for (const sourceItem of rows("source_items").filter(
              (s) => s.accountKey === old,
            ))
              removeContent(sourceItem.id);
          db.exec("DELETE FROM integration_state WHERE id='gmailSync'");
          db.prepare(
            "INSERT INTO integration_state VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
          ).run("gmailConnection", JSON.stringify({ id }));
        }
      });
    },
    clearMailConnection() {
      return transaction(() => {
        const connection = getStore().integrationState("gmailConnection")?.id;
        db.exec(
          "DELETE FROM integration_state WHERE id IN ('gmailTokens','gmailConnection','gmailSync')",
        );
        for (const row of rows("source_items").filter(
          (s) => s.kind === "email" && s.accountKey === connection,
        ))
          removeContent(row.id);
      });
    },
    importMailBatch(items, state) {
      return transaction(() => {
        if (
          getStore().integrationState("gmailConnection")?.id !==
          state.connectionId
        )
          fail("Mail connection changed", 409);
        for (const sourceItem of rows("source_items").filter(
          (s) =>
            s.accountKey === state.connectionId &&
            (state.deletedExternalIds || []).includes(s.externalId),
        ))
          removeContent(sourceItem.id);
        const result = items.map((item) => putSource(item));
        db.prepare(
          "INSERT INTO integration_state VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        ).run("gmailSync", JSON.stringify(state));
        return result;
      });
    },
    listSources: () =>
      rows("source_items").filter((s) =>
        db
          .prepare("SELECT 1 FROM source_items WHERE id=? AND profile_id=?")
          .get(s.id, profile),
      ),
    listCandidates: () =>
      db
        .prepare("SELECT data FROM task_candidates WHERE profile_id=?")
        .all(profile)
        .map(parsed),
    importTaskSource: (input, now) => transaction(() => putSource(input, now)),
    revokeTaskSource: (id) =>
      transaction(() => {
        if (!source(id)) fail("Source not found", 404);
        removeContent(id);
        return { revoked: true };
      }),
    saveTaskDiscovery(id, version, proposals) {
      return transaction(() => {
        const item = source(id);
        if (!item || item.revoked || item.version !== version)
          fail("Source changed; refresh discovery", 409);
        if (!Array.isArray(proposals) || proposals.length > 20)
          fail("Too many task candidates");
        return proposals.map((proposal) => {
          if (
            typeof proposal.title !== "string" ||
            !proposal.title.trim() ||
            proposal.title.length > 500 ||
            typeof proposal.quote !== "string" ||
            !proposal.quote.trim() ||
            !item.text.includes(proposal.quote)
          )
            fail("A task needs an exact supporting source quote");
          const candidateId =
              "candidate:" +
              hash([
                id,
                proposal.quote.normalize("NFKC").trim(),
                proposal.title.normalize("NFKC").trim(),
              ]).slice(0, 40),
            previous = candidate(candidateId);
          const baseline =
            Number.isInteger(proposal.minutes) &&
            proposal.minutes > 0 &&
            proposal.minutes <= 525600
              ? proposal.minutes
              : null;
          const next = {
            id: candidateId,
            sourceId: id,
            sourceVersion: version,
            title: proposal.title.trim(),
            quote: proposal.quote,
            state:
              previous && previous.sourceVersion === version
                ? previous.state
                : "suggested",
            taskId: previous?.taskId || null,
            revision: (previous?.revision || 0) + 1,
            ownership: "Review whether this is your commitment.",
            baseline,
            scope:
              proposal.scope === "remaining_task"
                ? "remaining_task"
                : "next_session",
            deadlineSuggestion: require("./sourceExtraction.cjs").candidates(
              proposal.quote,
              item,
              getStore().getSettings().timezone,
            ),
          };
          saveCandidate(next);
          return next;
        });
      });
    },
    reviewCandidate(id, input) {
      return transaction(() => {
        const item = candidate(id);
        if (!item) fail("Candidate not found", 404);
        if (item.revision !== input.revision)
          fail("Candidate changed; reload", 409);
        const evidence = source(item.sourceId);
        if (
          input.state !== "dismissed" &&
          (!evidence ||
            evidence.revoked ||
            evidence.version !== item.sourceVersion)
        )
          fail("Source changed; refresh discovery", 409);
        if (!["accepted", "dismissed"].includes(input.state))
          fail("Accept or dismiss this candidate");
        let taskId = item.taskId;
        if (input.state === "accepted" && !taskId) {
          if (input.taskId) {
            if (!task(input.taskId)) fail("Merge target not found", 404);
            taskId = input.taskId;
          } else {
            taskId = "task:" + crypto.randomUUID();
            const next = {
              id: taskId,
              profileId: profile,
              journalId: null,
              identity: item.id,
              title: item.title,
              status: "open",
              confirmed: {},
              revision: 1,
              generation: 0,
              createdAt: new Date().toISOString(),
              baseline: item.baseline,
              scope: item.scope,
              features: {
                category: "source_task",
                unit: hash(item.title.normalize("NFKC").toLowerCase()),
                scope: item.scope,
                baselineVersion: "scoped-v1",
              },
              candidates: item.deadlineSuggestion,
            };
            db.prepare("INSERT INTO durable_tasks VALUES(?,?,?,?,?)").run(
              taskId,
              profile,
              null,
              item.id,
              JSON.stringify(next),
            );
          }
          db.prepare("INSERT OR IGNORE INTO task_sources VALUES(?,?)").run(
            taskId,
            item.sourceId,
          );
        }
        if (input.state === "accepted") {
          db.prepare("INSERT OR IGNORE INTO task_sources VALUES(?,?)").run(
            taskId,
            item.sourceId,
          );
          const record = task(taskId),
            changed =
              record.sourceVersions?.[item.sourceId] !== item.sourceVersion;
          if (changed) {
            const updated = {
              ...record,
              sourceVersions: {
                ...record.sourceVersions,
                [item.sourceId]: item.sourceVersion,
              },
              revision: record.revision + (item.taskId || input.taskId ? 1 : 0),
            };
            db.prepare("UPDATE durable_tasks SET data=? WHERE id=?").run(
              JSON.stringify(updated),
              taskId,
            );
          }
        }
        const next = {
          ...item,
          state: input.state,
          taskId,
          revision: item.revision + 1,
        };
        saveCandidate(next);
        return next;
      });
    },
    prepareTaskPlan(input, now = new Date().toISOString()) {
      return transaction(() => {
        const store = getStore(),
          settings = store.getSettings();
        if (
          !Array.isArray(input.taskIds) ||
          !input.taskIds.length ||
          input.taskIds.length > 20 ||
          new Set(input.taskIds).size !== input.taskIds.length
        )
          fail("Choose 1–20 accepted tasks");
        const evidence = [],
          tasks = [],
          estimates = [],
          snapshots = [],
          sources = [],
          estimateSnapshots = [];
        for (const id of input.taskIds) {
          const item = task(id);
          if (!item) fail("Task not found", 404);
          const confirmed = item.confirmed || {};
          const linked = db
            .prepare("SELECT source_id FROM task_sources WHERE task_id=?")
            .all(id)
            .map((x) => source(x.source_id))
            .filter(Boolean);
          for (let index = linked.length - 1; index >= 0; index--)
            if (linked[index].revoked) linked.splice(index, 1);
          if (!linked.length && item.journalId) {
            const journal = store.getJournal(item.journalId);
            if (journal)
              linked.push({
                id: journal.id,
                kind: "journal",
                text: journal.content,
                title: journal.title,
                version: journal.updatedAt || "legacy",
                sourceTimestamp: journal.updatedAt,
              });
          }
          if (!linked.length)
            fail(
              "This task has no readable source; add or confirm its source before planning",
              409,
            );
          for (const linkedSource of linked) {
            assertMailFresh(linkedSource, now);
            if (
              item.sourceVersions?.[linkedSource.id] &&
              item.sourceVersions[linkedSource.id] !== linkedSource.version
            )
              fail(
                "Task source changed; rediscover and review it before planning",
                409,
              );
            const associated = rows("task_candidates").filter(
              (c) => c.taskId === id && c.sourceId === linkedSource.id,
            );
            if (
              associated.length &&
              !associated.some(
                (c) =>
                  c.state === "accepted" &&
                  c.sourceVersion === linkedSource.version,
              )
            )
              fail(
                "Task source changed; rediscover and review it before planning",
                409,
              );
          }
          const ids = linked.map((s) => {
            const evidenceId = "e:" + hash([id, s.id]).slice(0, 32);
            evidence.push({
              id: evidenceId,
              sourceType: "document",
              sourceId: s.id,
              sourceVersion: s.version,
              locator: s.locator || null,
              excerpt: s.text.slice(0, 4000) || s.title,
              observedAt: now,
              sourceTimestamp: s.sourceTimestamp || null,
              verification: "source_matched",
              facts: [],
            });
            sources.push({
              id: s.id,
              version: s.version,
              journal: s.kind === "journal",
              journalId: s.externalId || s.id,
            });
            return evidenceId;
          });
          const facts = [];
          if (confirmed.deadline)
            facts.push({ field: "deadline", value: confirmed.deadline.at });
          if (confirmed.importance)
            facts.push({ field: "importance", value: confirmed.importance });
          if (confirmed.status)
            facts.push({ field: "status", value: confirmed.status });
          if (confirmed.effort)
            facts.push({
              field: "effort_minutes",
              value: confirmed.effort.minutes,
            });
          if (facts.length) {
            const factId = "facts:" + id.slice(5);
            evidence.push({
              id: factId,
              sourceType: "user",
              sourceId: id,
              sourceVersion: String(item.revision),
              locator: null,
              excerpt: JSON.stringify(confirmed),
              observedAt: now,
              sourceTimestamp: null,
              verification: "user_confirmed",
              facts,
            });
            ids.push(factId);
          }
          const selectedScope =
            confirmed.effort?.scope ||
            item.scope ||
            item.features?.scope ||
            "next_session";
          const basis =
            item.baselineScopes?.[selectedScope] ||
            ((item.scope || item.features?.scope || "next_session") ===
            selectedScope
              ? item.baseline
              : null) ||
            confirmed.effort?.minutes;
          const features = {
            ...(item.features || {
              category: "journal_task",
              unit: hash(item.title),
              baselineVersion: "scoped-v1",
            }),
            scope: selectedScope,
          };
          const prediction = estimate({
            baseline: basis,
            features,
            history: rows("effort_records").filter((x) => task(x.taskId)),
            now,
          });
          const selected =
              "effort" in confirmed && confirmed.effort === null
                ? null
                : confirmed.effort?.minutes || prediction.minutes,
            estimateId = selected ? "estimate:" + id.slice(5) : null;
          if (prediction.basis === "personal_history" && !confirmed.effort) {
            const historyId = "history:" + id.slice(5);
            evidence.push({
              id: historyId,
              sourceType: "history",
              sourceId: id,
              sourceVersion: hash(prediction),
              locator: null,
              excerpt: JSON.stringify(prediction),
              observedAt: now,
              sourceTimestamp: null,
              verification: "source_matched",
              facts: [{ field: "effort_minutes", value: prediction.minutes }],
            });
            ids.push(historyId);
          }
          if (selected)
            estimates.push({
              id: estimateId,
              taskId: id,
              scope: confirmed.effort?.scope || item.scope || "next_session",
              basis: confirmed.effort ? "project_estimate" : prediction.basis,
              effortMinutes: {
                low: Math.min(prediction.low || selected, selected),
                expected: selected,
                high: Math.max(prediction.high || selected, selected),
              },
              confidence: "low",
              evidenceIds: ids,
              assumptions: [
                "Provisional active-effort estimate; calendar reservations are not measured outcomes.",
              ],
              rationale: confirmed.effort
                ? "Selected by you."
                : `${prediction.version}; ${prediction.comparableTasks || 0} comparable completed tasks.`,
            });
          const hasSession = db
            .prepare(
              "SELECT 1 FROM task_sessions WHERE task_id=? AND generation=?",
            )
            .get(id, item.generation);
          tasks.push({
            id,
            title: item.title,
            description: item.title,
            status: hasSession ? "blocked" : item.status,
            evidenceIds: ids,
            importance: {
              level: confirmed.importance || "medium",
              basis: confirmed.importance ? "user" : "inferred",
              reason: "Review against your commitments.",
              evidenceIds: ids,
            },
            deadline: confirmed.deadline
              ? { ...confirmed.deadline, evidenceIds: ids }
              : null,
            estimateId,
            dependsOn: confirmed.dependsOn || [],
            clarificationQuestions: hasSession
              ? [
                  "This task already has a calendar session. Request another session explicitly.",
                ]
              : [],
          });
          snapshots.push({
            id,
            revision: item.revision,
            generation: item.generation,
            sessions: db
              .prepare(
                "SELECT event_id FROM task_sessions WHERE task_id=? AND generation=? ORDER BY event_id",
              )
              .all(id, item.generation)
              .map((x) => x.event_id),
          });
          estimateSnapshots.push({
            taskId: id,
            baseline: basis || null,
            baselineVersion: "scoped-v1",
            features,
            prediction,
          });
        }
        if (
          tasks.some((t) =>
            t.dependsOn.some((id) => !input.taskIds.includes(id)),
          )
        )
          fail("Include task dependencies in this plan or review them first");
        const plan = {
          id: "plan:" + crypto.randomUUID(),
          state: "proposal",
          timezone: settings.timezone,
          targetDate: input.targetDate,
          availability: require("./workingCalendar.cjs").resolve(
            settings,
            input.targetDate,
            input.availability,
          ),
          bufferMinutes: 15,
          blocks: [],
          unscheduled: [],
          warnings: [],
        };
        const range = planningRange(plan);
        store.assertCalendarCoverage(range, now);
        const events = store.listPlanningEvents(range),
          notBefore = new Date(
            Date.parse(now) + (settings.planningLeadMinutes || 5) * 60000,
          ).toISOString();
        const scheduled = scheduleBundle(
          { schemaVersion: 2, evidence, tasks, estimates, plan },
          { events, notBefore },
        );
        const result = {
          id: plan.id,
          contract: scheduled.contract,
          calendarFingerprint: scheduled.calendarFingerprint,
          settingsHash: hash(settings),
          taskSnapshots: snapshots,
          sourceSnapshots: sources,
          estimateSnapshots,
          notBefore,
          createdAt: now,
          applied: false,
        };
        savePlan(result);
        return result;
      });
    },
    applyTaskPlan(id, now = new Date().toISOString()) {
      return transaction(() => {
        const item = getPlan(id);
        if (!item) fail("Plan not found", 404);
        if (item.applied) return { ...item, replayed: true };
        const store = getStore();
        if (hash(store.getSettings()) !== item.settingsHash)
          fail("Settings changed; prepare a new plan", 409);
        for (const snapshot of item.taskSnapshots) {
          const current = task(snapshot.id),
            sessions = db
              .prepare(
                "SELECT event_id FROM task_sessions WHERE task_id=? AND generation=? ORDER BY event_id",
              )
              .all(snapshot.id, snapshot.generation)
              .map((x) => x.event_id);
          if (
            !current ||
            current.revision !== snapshot.revision ||
            current.generation !== snapshot.generation ||
            JSON.stringify(sessions) !== JSON.stringify(snapshot.sessions)
          )
            fail("Task changed; prepare a new plan", 409);
        }
        for (const snapshot of item.sourceSnapshots) {
          const current = snapshot.journal
            ? store.getJournal(snapshot.journalId)
            : source(snapshot.id);
          if (
            !current ||
            current.revoked ||
            (snapshot.journal ? current.updatedAt : current.version) !==
              snapshot.version
          )
            fail("Source changed; refresh and review a new plan", 409);
          if (!snapshot.journal) assertMailFresh(current, now);
        }
        assertBundle(item.contract);
        const range = planningRange(item.contract.plan);
        store.assertCalendarCoverage(range, now);
        const expected = scheduleBundle(item.contract, {
          events: store.listPlanningEvents(range),
          notBefore: item.notBefore,
        });
        if (
          expected.calendarFingerprint !== item.calendarFingerprint ||
          JSON.stringify(expected.contract.plan) !==
            JSON.stringify(item.contract.plan) ||
          item.contract.plan.blocks.some(
            (b) => Date.parse(b.startsAt) <= Date.parse(now),
          )
        )
          fail("Calendar or start time changed; prepare a new plan", 409);
        if (!item.contract.plan.blocks.length)
          fail("This plan contains no schedulable blocks");
        const events = item.contract.plan.blocks.map((block) => {
          const event = {
            id: crypto.randomUUID(),
            title: item.contract.tasks.find((t) => t.id === block.taskId).title,
            startsAt: block.startsAt,
            endsAt: block.endsAt,
            sourceTaskId: block.taskId,
            sourceAnalysisId: id,
            calendarType: "personal",
            location: "",
            notes: block.rationale,
            color: "#2563eb",
            repeat: "none",
            notifyMinutesBefore: 15,
            notificationFormat: "Desktop notification",
            createdAt: now,
            updatedAt: now,
          };
          db.prepare("INSERT INTO events VALUES(?,?,?,?)").run(
            event.id,
            Date.parse(event.startsAt),
            Date.parse(event.endsAt),
            JSON.stringify(event),
          );
          db.prepare("INSERT INTO task_sessions VALUES(?,?,?)").run(
            event.id,
            block.taskId,
            task(block.taskId).generation,
          );
          return event;
        });
        const result = { ...item, applied: true, events, appliedAt: now };
        savePlan(result);
        return result;
      });
    },
    recordTaskEffort(id, input, now = new Date().toISOString()) {
      return transaction(() => {
        const item = task(id);
        if (!item) fail("Task not found", 404);
        if (
          typeof input.receipt !== "string" ||
          !input.receipt ||
          input.receipt.length > 100 ||
          !Number.isInteger(input.actualMinutes) ||
          input.actualMinutes < 1 ||
          input.actualMinutes > 525600 ||
          typeof input.completed !== "boolean"
        )
          fail("Record active minutes, completion and a unique receipt");
        const recordId = "effort:" + hash([profile, id, input.receipt]),
          old = parsed(
            db
              .prepare("SELECT data FROM effort_records WHERE id=?")
              .get(recordId),
          );
        if (old) return old;
        const plan = input.planId ? getPlan(input.planId) : null,
          snapshot = plan?.estimateSnapshots.find((x) => x.taskId === id);
        if (!snapshot?.baseline)
          fail("Choose the original plan estimate before recording an outcome");
        const record = {
          id: recordId,
          taskId: id,
          actualMinutes: input.actualMinutes,
          completed: input.completed,
          completedAt: now,
          estimatedAt: plan.createdAt,
          generation: item.generation,
          baseline: snapshot.baseline,
          baselineVersion: snapshot.baselineVersion,
          features: snapshot.features,
          provenance: "user_entered_active_minutes",
          planId: plan.id,
        };
        if (
          input.completed &&
          rows("effort_records").some(
            (x) => x.taskId === id && x.completed && x.planId === plan.id,
          )
        )
          fail(
            "A completed outcome already exists for this task and plan",
            409,
          );
        db.prepare("INSERT INTO effort_records VALUES(?,?,?)").run(
          recordId,
          id,
          JSON.stringify(record),
        );
        return record;
      });
    },
  };
}
module.exports = { attach };
