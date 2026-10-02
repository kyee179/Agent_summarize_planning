const defaultData = {
  settings: {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    locale: "en-US",
    weekStartsOn: 0,
    defaultNotifyMinutesBefore: 15,
    aiProvider: "local",
    dailyAiRequestLimit: 10,
    defaultAvailability: [
      { label: "Evening focus", startsAt: "20:00", endsAt: "24:00" }
    ]
  },
  events: [
    {
      id: "seed-1",
      title: "Plan the week",
      startsAt: new Date(new Date().setHours(9, 0, 0, 0)).toISOString(),
      endsAt: new Date(new Date().setHours(9, 30, 0, 0)).toISOString(),
      calendarType: "personal",
      location: "Home",
      notes: "Review tasks, study goals, and reminders.",
      color: "#2563eb",
      notifyMinutesBefore: 15,
      notificationFormat: "Desktop notification",
      repeat: "none",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  journals: [],
  journalAnalyses: []
};

function ensureShape(data) {
  return {
    settings: { ...defaultData.settings, ...(data.settings || {}) },
    events: Array.isArray(data.events) ? data.events : [],
    journals: Array.isArray(data.journals) ? data.journals : [],
    journalAnalyses: Array.isArray(data.journalAnalyses) ? data.journalAnalyses : []
  };
}

module.exports = { defaultData, ensureShape };
