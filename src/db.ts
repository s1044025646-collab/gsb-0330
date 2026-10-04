import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const DATA_DIR = process.env.HH_DATA_DIR ?? path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.HH_DB_PATH ?? path.join(DATA_DIR, "hh.db");

export const db = new DatabaseSync(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS sequences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vertices TEXT NOT NULL,
  status TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  tie_break TEXT NOT NULL,
  reason TEXT,
  edges TEXT,
  steps TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sequence_id INTEGER,
  ok INTEGER NOT NULL,
  report TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export function insertSequence(row: {
  vertices: string;
  status: string;
  algorithm_version: string;
  tie_break: string;
  reason: string | null;
  edges: string | null;
  steps: string;
}): number {
  const stmt = db.prepare(
    `INSERT INTO sequences (vertices,status,algorithm_version,tie_break,reason,edges,steps)
     VALUES (?,?,?,?,?,?,?)`
  );
  const r = stmt.run(
    row.vertices,
    row.status,
    row.algorithm_version,
    row.tie_break,
    row.reason,
    row.edges,
    row.steps
  );
  return Number(r.lastInsertRowid);
}

export function getSequence(id: number) {
  return db.prepare(`SELECT * FROM sequences WHERE id=?`).get(id) as
    | {
        id: number;
        vertices: string;
        status: string;
        algorithm_version: string;
        tie_break: string;
        reason: string | null;
        edges: string | null;
        steps: string;
        created_at: string;
      }
    | undefined;
}

export function listSequences() {
  return db
    .prepare(`SELECT id,status,algorithm_version,reason,created_at FROM sequences ORDER BY id`)
    .all();
}

export function insertVerification(sequenceId: number | null, ok: boolean, report: string) {
  const r = db
    .prepare(`INSERT INTO verifications (sequence_id,ok,report) VALUES (?,?,?)`)
    .run(sequenceId, ok ? 1 : 0, report);
  return Number(r.lastInsertRowid);
}
