const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const taskSignals = [
  "need to",
  "should",
  "have to",
  "must",
  "not finished",
  "unfinished",
  "remaining",
  "later",
  "maybe it's time",
  "maybe it is time",
  "deadline",
  "assessment",
  "dissertation",
  "experiment",
  "project",
  "cv",
  "job",
  "supervisor",
  "meeting",
  "test"
];

const priorityWeights = [
  { pattern: /deadline|assessment|interview|urgent|must|have to/i, priority: "high", urgency: "high", minutes: 90 },
  { pattern: /dissertation|experiment|supervisor|graduation/i, priority: "high", urgency: "medium", minutes: 120 },
  { pattern: /job|cv|application|company/i, priority: "medium", urgency: "medium", minutes: 75 },
  { pattern: /project|coding|vibe coding|portfolio/i, priority: "medium", urgency: "low", minutes: 90 },
  { pattern: /relationship|health|rest|family/i, priority: "medium", urgency: "medium", minutes: 45 }
];

function splitSentences(text) {
  return String(text || "")
    .split(/[\n.!?。！？]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function inferTask(sentence) {
  const hasSignal = taskSignals.some((signal) => sentence.toLowerCase().includes(signal));
  if (!hasSignal) return null;

  const matched = priorityWeights.find((weight) => weight.pattern.test(sentence)) || {
    priority: "low",
    urgency: "low",
    minutes: 45
  };

  return {
    title: sentence.length > 86 ? `${sentence.slice(0, 83)}...` : sentence,
    priority: matched.priority,
    urgency: matched.urgency,
    estimatedMinutes: matched.minutes,
    confidence: matched.priority === "low" ? "low" : "medium",
    reason: "Detected from journal wording and planning keywords."
  };
}

function parseDateForPlanning(targetDate) {
  const date = targetDate ? new Date(`${targetDate}T00:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

function toIsoOnDay(day, clock) {
  const [hourRaw, minuteRaw = "0"] = String(clock).split(":");
  const hour = Number(hourRaw === "24" ? 23 : hourRaw);
  const minute = Number(hourRaw === "24" ? 59 : minuteRaw);
  const date = new Date(day);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function buildScheduleDrafts(tasks, context = {}) {
  const day = parseDateForPlanning(context.targetDate);
  const availability = Array.isArray(context.availability) && context.availability.length > 0
    ? context.availability
    : [{ startsAt: "20:00", endsAt: "24:00" }];
  const sorted = [...tasks].sort((a, b) => {
    const score = { high: 3, medium: 2, low: 1 };
    return (score[b.priority] + score[b.urgency]) - (score[a.priority] + score[a.urgency]);
  });

  const drafts = [];
  let taskIndex = 0;

  availability.forEach((slot) => {
    let cursor = new Date(toIsoOnDay(day, slot.startsAt));
    const slotEnd = new Date(toIsoOnDay(day, slot.endsAt));
    if (slot.endsAt === "24:00") slotEnd.setHours(23, 59, 0, 0);

    while (taskIndex < sorted.length && cursor < slotEnd) {
      const task = sorted[taskIndex];
      const duration = Math.min(Number(task.estimatedMinutes || 45), Math.max(30, Math.floor((slotEnd - cursor) / 60000)));
      const end = new Date(cursor.getTime() + duration * 60000);
      if (end > slotEnd) break;

      drafts.push({
        title: task.title,
        startsAt: cursor.toISOString(),
        endsAt: end.toISOString(),
        calendarType: task.priority === "high" ? "study" : "personal",
        notifyMinutesBefore: 15,
        notificationFormat: "Desktop notification",
        source: "journal analysis",
        rationale: task.reason,
        confidence: task.confidence
      });

      cursor = new Date(end.getTime() + 15 * 60000);
      taskIndex += 1;
    }
  });

  return drafts;
}

function localRuleBasedAnalysis({ journal, relatedJournals = [], availability = [] } = {}) {
  const combinedText = [journal?.content, ...relatedJournals.map((item) => item.content)].filter(Boolean).join("\n");
  const sentences = splitSentences(combinedText);
  const tasks = sentences.map(inferTask).filter(Boolean).slice(0, 8);
  const summary = tasks.length > 0
    ? `Found ${tasks.length} planning signal${tasks.length === 1 ? "" : "s"} across the journal text.`
    : "No strong task signals were found. Save the journal, then add clearer action words or use an AI provider for deeper analysis.";

  return {
    provider: "local",
    model: "rule-based-v1",
    summary,
    weeklySummary: summarizeWeekly(sentences, tasks),
    tasks,
    scheduleDrafts: buildScheduleDrafts(tasks, {
      targetDate: journal?.journalDate || new Date().toISOString().slice(0, 10),
      availability
    }),
    cautions: [
      "Local fallback uses keywords and simple scheduling rules; use an AI provider for nuanced prioritization."
    ]
  };
}

function summarizeWeekly(sentences, tasks) {
  const themes = [];
  if (sentences.some((sentence) => /job|cv|application|assessment|interview/i.test(sentence))) themes.push("job search");
  if (sentences.some((sentence) => /dissertation|experiment|supervisor|graduation/i.test(sentence))) themes.push("dissertation");
  if (sentences.some((sentence) => /coding|project|portfolio/i.test(sentence))) themes.push("project work");
  if (sentences.some((sentence) => /relationship|stress|problem|health/i.test(sentence))) themes.push("personal wellbeing");

  if (themes.length === 0) return "The week has been logged, but no dominant theme was detected locally.";
  return `This week mainly involved ${themes.join(", ")}. ${tasks.length} possible follow-up task${tasks.length === 1 ? "" : "s"} were detected.`;
}

function getProviderConfig(settings = {}) {
  const provider = process.env.AI_PROVIDER || settings.aiProvider || "local";
  return {
    provider,
    openaiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    geminiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
    groqKey: process.env.GROQ_API_KEY,
    groqModel: process.env.GROQ_MODEL || "llama-3.1-8b-instant"
  };
}

function buildPrompt({ journal, relatedJournals = [], availability = [] }) {
  return `You are a careful personal planning assistant. Analyze the journal text and return strict JSON only.\n\nRules:\n- Extract only actionable tasks.\n- Ignore low-value notes unless they imply an action.\n- Weekly journals set priority; daily journals adjust today's plan.\n- Use explicit times from the journal when present.\n- Otherwise schedule only inside availability windows.\n- Leave buffer time and do not overload the day.\n- Explain why each schedule draft exists.\n\nReturn this JSON shape exactly:\n{\n  "summary": "string",\n  "weeklySummary": "string",\n  "tasks": [{ "title": "string", "priority": "high|medium|low", "urgency": "high|medium|low", "estimatedMinutes": 30, "confidence": "high|medium|low", "reason": "string" }],\n  "scheduleDrafts": [{ "title": "string", "startsAt": "ISO date", "endsAt": "ISO date", "calendarType": "study|personal|other", "notifyMinutesBefore": 15, "notificationFormat": "Desktop notification", "source": "journal analysis", "rationale": "string", "confidence": "high|medium|low" }],\n  "cautions": ["string"]\n}\n\nJournal:\n${JSON.stringify(journal, null, 2)}\n\nRelated journals:\n${JSON.stringify(relatedJournals, null, 2)}\n\nAvailability:\n${JSON.stringify(availability, null, 2)}\n\nCurrent timezone: ${DEFAULT_TIMEZONE}`;
}

function parseJsonText(text) {
  const trimmed = String(text || "").trim();
  const match = trimmed.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : trimmed);
}

function normalizeRemoteAnalysis(result, provider, model, fallbackContext) {
  return {
    provider,
    model,
    summary: result.summary || "Analysis completed.",
    weeklySummary: result.weeklySummary || "No weekly summary returned.",
    tasks: Array.isArray(result.tasks) ? result.tasks : [],
    scheduleDrafts: Array.isArray(result.scheduleDrafts) ? result.scheduleDrafts : buildScheduleDrafts(result.tasks || [], fallbackContext),
    cautions: Array.isArray(result.cautions) ? result.cautions : []
  };
}

async function callOpenAiCompatible({ apiKey, model, baseUrl, prompt, provider, fallbackContext }) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return valid JSON only." },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!response.ok) throw new Error(`${provider} returned ${response.status}`);
  const data = await response.json();
  return normalizeRemoteAnalysis(parseJsonText(data.choices?.[0]?.message?.content), provider, model, fallbackContext);
}

async function callGemini({ apiKey, model, prompt, fallbackContext }) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) throw new Error(`gemini returned ${response.status}`);
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text).join("\n");
  return normalizeRemoteAnalysis(parseJsonText(text), "gemini", model, fallbackContext);
}

async function analyzeJournal(input = {}) {
  const settings = input.settings || {};
  const config = getProviderConfig(settings);
  const availability = input.availability || settings.defaultAvailability || [];
  const fallbackContext = { targetDate: input.journal?.journalDate, availability };
  const prompt = buildPrompt({ ...input, availability });

  try {
    if (config.provider === "openai" && config.openaiKey) {
      return await callOpenAiCompatible({
        apiKey: config.openaiKey,
        model: config.openaiModel,
        baseUrl: "https://api.openai.com/v1",
        prompt,
        provider: "openai",
        fallbackContext
      });
    }
    if (config.provider === "groq" && config.groqKey) {
      return await callOpenAiCompatible({
        apiKey: config.groqKey,
        model: config.groqModel,
        baseUrl: "https://api.groq.com/openai/v1",
        prompt,
        provider: "groq",
        fallbackContext
      });
    }
    if (config.provider === "gemini" && config.geminiKey) {
      return await callGemini({ apiKey: config.geminiKey, model: config.geminiModel, prompt, fallbackContext });
    }
  } catch (error) {
    const fallback = localRuleBasedAnalysis({ ...input, availability });
    fallback.provider = "local-fallback";
    fallback.cautions = [`AI provider failed: ${error.message}`, ...fallback.cautions];
    return fallback;
  }

  return localRuleBasedAnalysis({ ...input, availability });
}

module.exports = {
  analyzeJournal,
  buildScheduleDrafts,
  inferTask,
  localRuleBasedAnalysis,
  splitSentences
};