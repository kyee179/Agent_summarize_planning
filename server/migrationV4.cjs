function migrate(db) {
  if (db.prepare("PRAGMA user_version").get().user_version >= 4) return;
  // Rebuild child links explicitly so dropping the old journal-owned table cannot cascade away sessions.
  const links = db.prepare("SELECT * FROM task_analyses").all(),
    sessions = db.prepare("SELECT * FROM task_sessions").all();
  db.exec(`DROP TABLE task_analyses; DROP TABLE task_sessions;
    CREATE TABLE tasks_v4(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,journal_id TEXT,identity TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),UNIQUE(profile_id,journal_id,identity));
    INSERT INTO tasks_v4 SELECT * FROM durable_tasks; DROP TABLE durable_tasks; ALTER TABLE tasks_v4 RENAME TO durable_tasks;
    CREATE TABLE task_analyses(analysis_id TEXT NOT NULL,task_id TEXT NOT NULL REFERENCES durable_tasks(id) ON DELETE CASCADE,PRIMARY KEY(analysis_id,task_id));
    CREATE TABLE task_sessions(event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,task_id TEXT NOT NULL REFERENCES durable_tasks(id) ON DELETE CASCADE,generation INTEGER NOT NULL);
    CREATE TABLE source_items(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE TABLE task_sources(task_id TEXT NOT NULL REFERENCES durable_tasks(id) ON DELETE CASCADE,source_id TEXT NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,PRIMARY KEY(task_id,source_id));
    CREATE TABLE task_candidates(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,source_id TEXT NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE TABLE effort_records(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES durable_tasks(id) ON DELETE CASCADE,data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE TABLE task_plans(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)));
    PRAGMA user_version=4;`);
  for (const row of links)
    db.prepare("INSERT INTO task_analyses VALUES(?,?)").run(
      row.analysis_id,
      row.task_id,
    );
  for (const row of sessions)
    db.prepare("INSERT INTO task_sessions VALUES(?,?,?)").run(
      row.event_id,
      row.task_id,
      row.generation,
    );
  for (const row of db.prepare("SELECT id,data FROM journals").all()) {
    const journal = JSON.parse(row.data),
      source = {
        id: `journal:${row.id}`,
        kind: "journal",
        externalId: row.id,
        version: journal.updatedAt || "legacy",
        text: journal.content || "",
        title: journal.title || "",
        observedAt: journal.updatedAt || new Date().toISOString(),
      };
    const tasks = db
      .prepare("SELECT id,profile_id FROM durable_tasks WHERE journal_id=?")
      .all(row.id);
    if (tasks.length) {
      db.prepare("INSERT INTO source_items VALUES(?,?,?)").run(
        source.id,
        tasks[0].profile_id,
        JSON.stringify(source),
      );
      for (const task of tasks)
        db.prepare("INSERT INTO task_sources VALUES(?,?)").run(
          task.id,
          source.id,
        );
    }
  }
}
module.exports = { migrate };
