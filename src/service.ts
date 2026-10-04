import {
  ALGORITHM_VERSION,
  ConstructResult,
  InputVertex,
  VerifyResult
} from "./types";
import { construct, validateInput } from "./havel";
import { buildAdjacency, verifyCandidate } from "./verify";
import { ConstructionRow, Store } from "./store";

export function summarizeRounds(rounds: { round: number; pivot: string; pivotDegree: number; neighbors: string[] }[]) {
  return rounds.map((r) => ({
    round: r.round,
    pivot: r.pivot,
    degree: r.pivotDegree,
    connectedTo: r.neighbors
  }));
}

/** 成功/失败报告；失败时保留原序列与消减过程，绝不含一张“缺边图”。 */
export function buildReport(vertices: InputVertex[], result: ConstructResult, verify: VerifyResult | null) {
  const base = {
    algorithmVersion: ALGORITHM_VERSION,
    input: vertices,
    tieRule:
      "剩余度数降序；平局时按固定顶点编号升序（数值编号按数值，否则字典序）",
    rounds: result.rounds,
    summary: summarizeRounds(result.rounds)
  };
  if (result.realizable) {
    return {
      ...base,
      status: "success" as const,
      edgeCount: result.edges.length,
      edges: result.edges,
      degrees: verify?.degrees ?? null,
      adjacency: buildAdjacency(
        vertices.map((v) => v.id),
        result.edges
      )
    };
  }
  return {
    ...base,
    status: "failure" as const,
    reasonCode: result.reasonCode,
    message: result.message,
    failedRound: result.failedRound,
    pivot: result.pivot ?? null,
    pivotDegree: result.pivotDegree ?? null,
    availableNeighbors: result.availableNeighbors ?? null,
    residualAtFailure: result.residualAtFailure
  };
}

export class GraphService {
  constructor(readonly store: Store) {}

  createSequence(rawVertices: unknown) {
    const vertices = validateInput(rawVertices);
    return this.store.createSequence(vertices);
  }

  build(sequenceId: number) {
    const seq = this.store.getSequence(sequenceId);
    if (!seq) return null;
    const result: ConstructResult = construct(seq.vertices);
    let verification: VerifyResult | null = null;
    if (result.realizable) {
      verification = verifyCandidate(seq.vertices, result.edges);
    }
    const report = buildReport(seq.vertices, result, verification);
    const version = this.store.nextVersion(sequenceId);
    const row = this.store.saveConstruction(sequenceId, version, result, report);
    if (result.realizable && verification) {
      this.store.saveCandidate(sequenceId, "generated", result.edges, verification);
    }
    return { construction: row, report };
  }

 importCandidate(sequenceId: number, rawEdges: unknown) {
    const seq = this.store.getSequence(sequenceId);
    if (!seq) return null;
    // 先做边数组的结构容错，再交给独立核验。
    const result = verifyCandidate(seq.vertices, rawEdges);
    const edges = Array.isArray(rawEdges)
      ? (rawEdges as { u?: unknown; v?: unknown }[])
          .filter((e) => e && typeof e === "object" && typeof e.u === "string" && typeof e.v === "string")
          .map((e) => ({ u: e.u as string, v: e.v as string }))
      : [];
    const row = this.store.saveCandidate(sequenceId, "imported", edges, result);
    return { candidate: row, result };
  }

  adjacency(constructionId: number) {
    const construction = this.store.getConstruction(constructionId);
    if (!construction) return null;
    const seq = this.store.getSequence(construction.sequence_id);
    if (!seq) return null;
    return {
      constructionId: construction.id,
      status: construction.status,
      adjacency: buildAdjacency(
        seq.vertices.map((v) => v.id),
        construction.edges
      )
    };
  }

  compareVersions(sequenceId: number) {
    const versions = this.store.listVersions(sequenceId) as ConstructionRow[];
    return versions.map((c) => ({
      constructionId: c.id,
      version: c.version,
      status: c.status,
      reasonCode: c.reason_code,
      message: c.message,
      edgeCount: c.edges.length,
      roundCount: Array.isArray(c.rounds) ? c.rounds.length : 0,
      algorithmVersion: c.algorithm_version,
      createdAt: c.created_at
    }));
  }

  exportConstruction(constructionId: number) {
    const construction = this.store.getConstruction(constructionId);
    if (!construction) return null;
    const seq = this.store.getSequence(construction.sequence_id);
    if (!seq) return null;
    return {
      sequence: seq,
      construction: {
        id: construction.id,
        version: construction.version,
        status: construction.status,
        algorithmVersion: construction.algorithm_version,
        createdAt: construction.created_at
      },
      report: construction.report
    };
  }
}
