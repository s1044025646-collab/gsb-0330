import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ALGORITHM_VERSION, ConstructResult, Edge, InputVertex, VerifyResult } from "./types";
import { canonicalEdge } from "./havel";

export interface SequenceRow {
  id: number;
  input_order: string;
  vertices: InputVertex[];
  tie_rule: string;
  algorithm_version: string;
  created_at: string;
}

export interface ConstructionRow {
  id: number;
  sequence_id: number;
  version: number;
  status: "success" | "failure";
  reason_code: string | null;
  message: string | null;
  edges: Edge[];
  rounds: unknown;
  report: unknown;
  algorithm_version: string;
  created_at: string;
}

export interface CandidateRow {
  id: number;
  sequence_id: number;
  source: "generated" | "imported";
  valid: 0 | 1;
  edges: Edge[];
  result: VerifyResult;
  created_at: string;
}

export const TIE_RULE = "剩余度数降序；平局时按固定顶点编号升序（数值编号按数值，否则字典序）";

export class Store {
  db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sequences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        input_order TEXT NOT NULL,
        vertices TEXT NOT NULL,
        tie_rule TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS constructions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sequence_id INTEGER NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('success','failure')),
        reason_code TEXT,
        message TEXT,
        edges TEXT NOT NULL,
        rounds TEXT NOT NULL,
        report TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (sequence_id, version)
      );
      CREATE TABLE IF NOT EXISTS candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sequence_id INTEGER NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('generated','imported')),
        valid INTEGER NOT NULL CHECK (valid IN (0,1)),
        edges TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  createSequence(vertices: InputVertex[]): SequenceRow {
    const stmt = this.db.prepare(
      `INSERT INTO sequences (input_order, vertices, tie_rule, algorithm_version)
       VALUES (?, ?, ?, ?)`
    );
    const info = stmt.run(
      JSON.stringify(vertices.map((v) => v.id)),
      JSON.stringify(vertices),
      TIE_RULE,
      ALGORITHM_VERSION
    );
    return this.getSequence(Number(info.lastInsertRowid))!;
  }

  getSequence(id: number): SequenceRow | null {
    const row = this.db.prepare(`SELECT * FROM sequences WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.hydrateSequence(row);
  }

  private hydrateSequence(row: Record<string, unknown>): SequenceRow {
    return {
      id: row.id as number,
      input_order: row.input_order as string,
      vertices: JSON.parse(row.vertices as string) as InputVertex[],
      tie_rule: row.tie_rule as string,
      algorithm_version: row.algorithm_version as string,
      created_at: row.created_at as string
    };
  }

  listSequences(): SequenceRow[] {
    const rows = this.db.prepare(`SELECT * FROM sequences ORDER BY id`).all() as Record<string, unknown>[];
    return rows.map((r) => this.hydrateSequence(r));
  }

  nextVersion(sequenceId: number): number {
    const row = this.db
      .prepare(`SELECT COALESCE(MAX(version), 0) + 1 AS v FROM constructions WHERE sequence_id = ?`)
      .get(sequenceId) as { v: number };
    return row.v;
  }

  saveConstruction(
    sequenceId: number,
    version: number,
    result: ConstructResult,
    report: unknown
  ): ConstructionRow {
    const edges = result.realizable
      ? result.edges.map((e) => canonicalEdge(e.u, e.v))
      : [];
    const stmt = this.db.prepare(
      `INSERT INTO constructions
        (sequence_id, version, status, reason_code, message, edges, rounds, report, algorithm_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      sequenceId,
      version,
      result.realizable ? "success" : "failure",
      result.realizable ? null : result.reasonCode,
      result.realizable ? null : result.message,
      JSON.stringify(edges),
      JSON.stringify(result.rounds),
      JSON.stringify(report),
      ALGORITHM_VERSION
    );
    return this.getConstruction(Number(info.lastInsertRowid))!;
  }

  getConstruction(id: number): ConstructionRow | null {
    const row = this.db
      .prepare(`SELECT * FROM constructions WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.hydrateConstruction(row) : null;
  }

  getVersion(sequenceId: number, version: number): ConstructionRow | null {
    const row = this.db
      .prepare(`SELECT * FROM constructions WHERE sequence_id = ? AND version = ?`)
      .get(sequenceId, version) as Record<string, unknown> | undefined;
    return row ? this.hydrateConstruction(row) : null;
  }

  listVersions(sequenceId: number): ConstructionRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM constructions WHERE sequence_id = ? ORDER BY version`)
      .all(sequenceId) as Record<string, unknown>[];
    return rows.map((r) => this.hydrateConstruction(r));
  }

  private hydrateConstruction(row: Record<string, unknown>): ConstructionRow {
    return {
      id: row.id as number,
      sequence_id: row.sequence_id as number,
      version: row.version as number,
      status: row.status as "success" | "failure",
      reason_code: (row.reason_code as string | null) ?? null,
      message: (row.message as string | null) ?? null,
      edges: JSON.parse(row.edges as string) as Edge[],
      rounds: JSON.parse(row.rounds as string),
      report: JSON.parse(row.report as string),
      algorithm_version: row.algorithm_version as string,
      created_at: row.created_at as string
    };
  }

  saveCandidate(
    sequenceId: number,
    source: "generated" | "imported",
    edges: Edge[],
    result: VerifyResult
  ): CandidateRow {
    const stmt = this.db.prepare(
      `INSERT INTO candidates (sequence_id, source, valid, edges, result) VALUES (?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      sequenceId,
      source,
      result.valid ? 1 : 0,
      JSON.stringify(edges.map((e) => canonicalEdge(e.u, e.v))),
      JSON.stringify(result)
    );
    return this.getCandidate(Number(info.lastInsertRowid))!;
  }

  getCandidate(id: number): CandidateRow | null {
    const row = this.db
      .prepare(`SELECT * FROM candidates WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as number,
      sequence_id: row.sequence_id as number,
      source: row.source as "generated" | "imported",
      valid: row.valid as 0 | 1,
      edges: JSON.parse(row.edges as string) as Edge[],
      result: JSON.parse(row.result as string) as VerifyResult,
      created_at: row.created_at as string
    };
  }

  close() {
    this.db.close();
  }
}
