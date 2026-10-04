import { runHavelHakimi, verifyGraph } from "./hh";
import { getSequence, insertSequence, insertVerification } from "./db";
import { ALGORITHM_VERSION, LIMITS, TIE_BREAK_RULE, VertexInput } from "./types";

export class ServiceError extends Error {
  constructor(public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export function parseVertices(input: unknown): VertexInput[] {
  if (!Array.isArray(input)) {
    throw new ServiceError("INVALID_FORMAT", "vertices 必须是数组");
  }
  if (input.length > LIMITS.MAX_VERTICES) {
    throw new ServiceError("LIMIT_EXCEEDED", `顶点数超过上限 ${LIMITS.MAX_VERTICES}`);
  }
  const seen = new Set<string>();
  const out: VertexInput[] = [];
  for (const [i, v] of input.entries()) {
    if (typeof v !== "object" || v === null) {
      throw new ServiceError("INVALID_FORMAT", `第 ${i} 项不是对象`);
    }
    const { id, degree } = v as Record<string, unknown>;
    if (typeof id !== "string" || id.length === 0) {
      throw new ServiceError("INVALID_FORMAT", `第 ${i} 项 id 必须是非空字符串`);
    }
    if (seen.has(id)) {
      throw new ServiceError("DUPLICATE_ID", `顶点编号重复: ${id}`);
    }
    seen.add(id);
    if (typeof degree !== "number" || !Number.isInteger(degree) || degree < 0) {
      throw new ServiceError("INVALID_DEGREE", `顶点 ${id} 的度必须是非负整数`);
    }
    if (degree >= input.length) {
      throw new ServiceError(
        "DEGREE_OUT_OF_RANGE",
        `顶点 ${id} 的度 ${degree} 不小于顶点数 ${input.length}`
      );
    }
    out.push({ id, degree });
  }
  return out;
}

export function construct(input: unknown) {
  const vertices = parseVertices(input);
  const total = vertices.reduce((s, v) => s + v.degree, 0);
  if (total % 2 !== 0) {
    throw new ServiceError("ODD_TOTAL_DEGREE", `总度数 ${total} 为奇数，不可能实现`, {
      necessaryConditionOnly: true,
    });
  }
  const maxEdges = (vertices.length * (vertices.length - 1)) / 2;
  if (total / 2 > LIMITS.MAX_EDGES || maxEdges > LIMITS.MAX_EDGES) {
    throw new ServiceError("LIMIT_EXCEEDED", `边数超过上限 ${LIMITS.MAX_EDGES}`);
  }
  const result = runHavelHakimi(vertices);
  const stepsJson = JSON.stringify(result.steps.slice(0, LIMITS.MAX_STEPS_STORED));
  const id = insertSequence({
    vertices: JSON.stringify(vertices),
    status: result.ok ? "realizable" : "unrealizable",
    algorithm_version: ALGORITHM_VERSION,
    tie_break: TIE_BREAK_RULE,
    reason: result.ok ? null : result.reason,
    edges: result.ok ? JSON.stringify(result.edges) : null,
    steps: stepsJson,
  });
  return { id, ...result };
}

export function getSequenceDetail(id: number) {
  const row = getSequence(id);
  if (!row) throw new ServiceError("NOT_FOUND", `序列 ${id} 不存在`);
  return {
    id: row.id,
    vertices: JSON.parse(row.vertices) as VertexInput[],
    status: row.status,
    algorithmVersion: row.algorithm_version,
    tieBreak: row.tie_break,
    reason: row.reason,
    edges: row.edges ? (JSON.parse(row.edges) as [string, string][]) : null,
    steps: JSON.parse(row.steps),
    createdAt: row.created_at,
  };
}

export function getAdjacency(id: number) {
  const detail = getSequenceDetail(id);
  const adj = new Map<string, string[]>(detail.vertices.map((v) => [v.id, []]));
  if (detail.edges) {
    for (const [a, b] of detail.edges) {
      adj.get(a)!.push(b);
      adj.get(b)!.push(a);
    }
  }
  for (const list of adj.values()) list.sort();
  return Object.fromEntries(adj);
}

export function verify(sequenceId: number | null, verticesInput: unknown, edgesInput: unknown) {
  let vertices: VertexInput[];
  if (sequenceId !== null) {
    vertices = getSequenceDetail(sequenceId).vertices;
  } else {
    vertices = parseVertices(verticesInput);
  }
  if (!Array.isArray(edgesInput)) {
    throw new ServiceError("INVALID_FORMAT", "edges 必须是数组");
  }
  const edges: [string, string][] = edgesInput.map((e, i) => {
    if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== "string" || typeof e[1] !== "string") {
      throw new ServiceError("INVALID_FORMAT", `第 ${i} 条边格式错误，应为 [idA, idB]`);
    }
    return [e[0], e[1]];
  });
  const result = verifyGraph(vertices, edges);
  const report = JSON.stringify({ vertices, edges, ...result });
  const verificationId = insertVerification(sequenceId, result.ok, report);
  return { verificationId, ...result };
}

export function compareVersions(idA: number, idB: number) {
  const a = getSequenceDetail(idA);
  const b = getSequenceDetail(idB);
  return {
    a: { id: a.id, status: a.status, vertices: a.vertices, algorithmVersion: a.algorithmVersion },
    b: { id: b.id, status: b.status, vertices: b.vertices, algorithmVersion: b.algorithmVersion },
    sameVertices: JSON.stringify(a.vertices) === JSON.stringify(b.vertices),
    sameAlgorithm: a.algorithmVersion === b.algorithmVersion,
  };
}

export function exportSequence(id: number) {
  const detail = getSequenceDetail(id);
  return {
    format: "hh-export-v1",
    ...detail,
    adjacency: getAdjacency(id),
  };
}
