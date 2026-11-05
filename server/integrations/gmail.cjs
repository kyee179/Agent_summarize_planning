const { createGoogle } = require("./google.cjs");
const { json, error } = require("./common.cjs");
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
function createGmail(store, options = {}) {
  const clock = options.clock || (() => new Date().toISOString());
  let generation = 0,
    running = false,
    refreshTimer = null,
    lastError = null;
  const facade = {
    integrationState: (key) =>
      store.integrationState(key.replace(/^google/, "gmail")),
    connectGoogle: (encrypted, id) => store.saveMailTokens(encrypted, id),
    refreshGoogleTokens: (encrypted, previous) =>
      store.saveMailTokens(encrypted, null, previous),
  };
  const oauth = createGoogle(facade, {
    ...options,
    scopeList: [SCOPE],
    connectionName: "Gmail",
  });
  const read = async (url) =>
    json(
      url,
      { headers: { Authorization: `Bearer ${await oauth.getAccessToken()}` } },
      { fetchImpl: options.fetchImpl, maxBytes: 1048576 },
    );
  function textPart(payload) {
    const plain = [],
      html = [];
    let parts = 0;
    const visit = (part, depth) => {
      if (!part || depth > 10 || ++parts > 100 || part.filename) return;
      if (part.body?.data) {
        const value = Buffer.from(part.body.data, "base64url").toString("utf8");
        if (part.mimeType === "text/plain") plain.push(value);
        else if (part.mimeType === "text/html") html.push(value);
      }
      for (const child of part.parts || []) visit(child, depth + 1);
    };
    visit(payload, 0);
    if (plain.length) return plain.join("\n");
    return html
      .join("\n")
      .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<!--[^]*?-->/g, "")
      .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>|<br\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(
        /&(?:nbsp|amp|lt|gt|quot|apos);|&#(?:x[0-9a-f]+|\d+);/gi,
        (entity) => {
          const named = {
            "&nbsp;": " ",
            "&amp;": "&",
            "&lt;": "<",
            "&gt;": ">",
            "&quot;": '"',
            "&apos;": "'",
          };
          if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
          const point =
            entity[2].toLowerCase() === "x"
              ? parseInt(entity.slice(3), 16)
              : parseInt(entity.slice(2), 10);
          return point > 0 && point <= 0x10ffff
            ? String.fromCodePoint(point)
            : "";
        },
      )
      .replace(/[\t ]+/g, " ")
      .trim();
  }
  return {
    status: () => ({
      ...oauth.status(),
      sync: store.integrationState("gmailSync"),
      syncing: running,
      autoRefreshing: Boolean(refreshTimer),
      lastError,
    }),
    connect: (input) => oauth.connect(input),
    cancel: () => {
      generation++;
      clearInterval(refreshTimer);
      refreshTimer = null;
      oauth.cancel();
    },
    close: () => {
      generation++;
      clearInterval(refreshTimer);
      refreshTimer = null;
      oauth.close();
    },
    async disconnect() {
      generation++;
      clearInterval(refreshTimer);
      refreshTimer = null;
      oauth.cancel();
      store.clearMailConnection();
      return {
        disconnected: true,
        revoked: false,
        warning:
          "Disconnected on this device. Revoking the shared Google application grant may also affect Calendar.",
      };
    },
    async sync(input) {
      if (input.consent !== true)
        throw error("Mail import needs your explicit permission");
      if (running) throw error("Gmail sync is already running", 409);
      const days = input.lookbackDays ?? 7,
        label = input.label || "INBOX";
      if (
        !Number.isInteger(days) ||
        days < 1 ||
        days > 30 ||
        !["INBOX", "STARRED", "IMPORTANT", "SENT"].includes(label)
      )
        throw error("Choose 1–30 days and an available Gmail folder");
      running = true;
      const current = generation,
        connection = store.integrationState("gmailConnection")?.id;
      try {
        const previous = store.integrationState("gmailSync"),
          profile = await read(
            "https://gmail.googleapis.com/gmail/v1/users/me/profile",
          );
        const ids = new Set(),
          deleted = new Set();
        let cursor = null,
          historyId = profile.historyId,
          partial = false;
        if (
          previous?.historyId &&
          previous.filter === `${days}:${label}` &&
          input.full !== true
        ) {
          try {
            for (let page = 0; page < 5; page++) {
              const params = new URLSearchParams({
                startHistoryId: previous.historyId,
                labelId: label,
                maxResults: "100",
                ...(cursor ? { pageToken: cursor } : {}),
              });
              const result = await read(
                "https://gmail.googleapis.com/gmail/v1/users/me/history?" +
                  params,
              );
              for (const entry of result.history || []) {
                for (const message of entry.messages || []) ids.add(message.id);
                for (const item of entry.messagesDeleted || [])
                  deleted.add(item.message.id);
              }
              historyId = result.historyId || historyId;
              cursor = result.nextPageToken;
              if (!cursor) {
                partial = true;
                break;
              }
              if (page === 4)
                throw error(
                  "Mail history limit reached; refresh a bounded full window",
                  409,
                );
            }
          } catch (e) {
            if (!e.message.includes("HTTP 404")) throw e;
            cursor = null;
            ids.clear();
          }
        }
        if (!partial) {
          const result = await read(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages?" +
              new URLSearchParams({
                q: `newer_than:${days}d -in:trash -in:spam`,
                labelIds: label,
                maxResults: "50",
              }),
          );
          if (result.nextPageToken)
            throw error(
              "More than 50 messages in this window. Choose fewer days or another folder, or import selected content.",
              409,
            );
          for (const message of result.messages || []) ids.add(message.id);
        }
        if (ids.size > 50)
          throw error(
            "More than 50 changed messages; use a bounded full refresh",
            409,
          );
        for (const id of deleted) ids.delete(id);
        const sources = [],
          threadIds = new Set();
        for (const id of ids) {
          if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(id))
            throw error("Invalid mail ID", 502);
          const message = await read(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/" +
              id +
              "?format=full",
          );
          threadIds.add(message.threadId);
          const headers = message.payload?.headers || [],
            subject =
              headers.find((h) => h.name.toLowerCase() === "subject")?.value ||
              "Email";
          const text = textPart(message.payload);
          if (!text.trim()) continue;
          const timestamp = new Date(
            Number(message.internalDate),
          ).toISOString();
          if (
            current !== generation ||
            store.integrationState("gmailConnection")?.id !== connection
          )
            throw error("Gmail connection changed", 409);
          sources.push({
            kind: "email",
            accountKey: connection,
            externalId: id,
            title: String(subject).slice(0, 500),
            text: text.slice(0, 40000),
            sourceTimestamp: timestamp,
            locator:
              "https://mail.google.com/mail/u/0/#all/" +
              encodeURIComponent(message.threadId),
          });
        }
        // Read bounded thread context to recognize quoted/cancelled requests; attachments remain excluded.
        if (threadIds.size > 20)
          throw error(
            "Too many distinct conversations; use selected-message import for this batch",
            409,
          );
        for (const id of threadIds) {
          if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(id))
            throw error("Invalid conversation ID", 502);
          const thread = await read(
            "https://gmail.googleapis.com/gmail/v1/users/me/threads/" +
              id +
              "?format=full",
          );
          if ((thread.messages || []).length > 10)
            throw error(
              "Conversation exceeds 10 messages; select the relevant content explicitly",
              409,
            );
          for (const message of thread.messages || []) {
            if (
              sources.some((s) => s.externalId === message.id) ||
              deleted.has(message.id)
            )
              continue;
            const text = textPart(message.payload);
            if (!text.trim()) continue;
            const subject =
              (message.payload?.headers || []).find(
                (h) => h.name.toLowerCase() === "subject",
              )?.value || "Email";
            sources.push({
              kind: "email",
              accountKey: connection,
              externalId: message.id,
              title: String(subject).slice(0, 500),
              text: text.slice(0, 40000),
              sourceTimestamp: new Date(
                Number(message.internalDate),
              ).toISOString(),
              locator:
                "https://mail.google.com/mail/u/0/#all/" +
                encodeURIComponent(id),
            });
          }
        }
        if (sources.length > 100)
          throw error(
            "Conversation context exceeds 100 messages; choose a smaller batch",
            409,
          );
        if (
          current !== generation ||
          store.integrationState("gmailConnection")?.id !== connection
        )
          throw error("Gmail connection changed", 409);
        const imported = store.importMailBatch(sources, {
          historyId,
          filter: `${days}:${label}`,
          deletedExternalIds: [...deleted],
          syncedAt: clock(),
          window: `${label}, most recent ${days} days; at most 50 changes, 20 conversations and 100 context messages`,
          mode: partial ? "incremental" : "initial",
          connectionId: connection,
        });
        for (const source of imported)
          store.saveTaskDiscovery(
            source.id,
            source.version,
            require("../sourceExtraction.cjs").localCandidates(source),
          );
        lastError = null;
        if (input.autoRefresh === true) {
          clearInterval(refreshTimer);
          refreshTimer = setInterval(
            () => this.sync({ ...input, consent: true }).catch(() => {}),
            600000,
          );
          refreshTimer.unref();
        } else if (input.autoRefresh === false) {
          clearInterval(refreshTimer);
          refreshTimer = null;
        }
        return { imported: imported.length, sources: imported };
      } catch (e) {
        lastError = e.message;
        throw e;
      } finally {
        running = false;
      }
    },
  };
}
module.exports = { createGmail, SCOPE };
