import { CandidateIssue, DegreeRow, Edge, InputVertex, VerifyResult } from "./types";
import { edgeKey } from "./havel";

/**
 * 独立候选图核验。不信任任何附带的度数统计，全部从边列表逐边复算。
 * 检查：陌生/缺失顶点、自环、无向重复边、实际度数是否等于目标度数。
 */
export function verifyCandidate(vertices: InputVertex[], rawEdges: unknown): VerifyResult {
  const issues: CandidateIssue[] = [];
  const target = new Map(vertices.map((v) => [v.id, v.degree]));
  const edges: Edge[] = [];

  if (!Array.isArray(rawEdges)) {
    return {
      valid: false,
      issues: [{ code: "UNKNOWN_VERTEX", message: "edges 必须是边对象数组" }],
      degrees: vertices.map((v) => ({ id: v.id, target: v.degree, actual: 0, match: v.degree === 0 })),
      edgeCount: 0
    };
  }

  rawEdges.forEach((raw, i) => {
    if (typeof raw !== "object" || raw === null) {
      issues.push({ code: "UNKNOWN_VERTEX", message: `第 ${i + 1} 条边不是对象` });
      return;
    }
    const { u, v } = raw as { u?: unknown; v?: unknown };
    if (typeof u !== "string" || typeof v !== "string") {
      issues.push({ code: "UNKNOWN_VERTEX", message: `第 ${i + 1} 条边的端点必须是字符串编号` });
      return;
    }
    const edge: Edge = { u, v };
    if (!target.has(u) || !target.has(v)) {
      issues.push({
        code: "UNKNOWN_VERTEX",
        message: `第 ${i + 1} 条边引用了不在原顶点集中的顶点：${!target.has(u) ? u : v}`,
        edge,
        vertex: !target.has(u) ? u : v
      });
      return;
    }
    if (u === v) {
      issues.push({ code: "SELF_LOOP", message: `存在自环边：顶点 ${u} 连接自身`, edge, vertex: u });
      return;
    }
    edges.push(edge);
  });

  // 无向重复边：规范化后比较，交换端点不算新边。
  const seen = new Map<string, Edge>();
  const deduped: Edge[] = [];
  for (const edge of edges) {
    const key = edgeKey(edge);
    if (seen.has(key)) {
      issues.push({
        code: "DUPLICATE_EDGE",
        message: `存在无向重复边：${edge.u}—${edge.v}（交换端点不构成新边）`,
        edge
      });
    } else {
      seen.set(key, edge);
      deduped.push(edge);
    }
  }

  // 从去重后的合法边逐边复算度数。
  const actual = new Map<string, number>(vertices.map((v) => [v.id, 0]));
  for (const { u, v } of deduped) {
    actual.set(u, (actual.get(u) ?? 0) + 1);
    actual.set(v, (actual.get(v) ?? 0) + 1);
  }

  const degrees: DegreeRow[] = vertices.map((v) => {
    const real = actual.get(v.id) ?? 0;
    return { id: v.id, target: v.degree, actual: real, match: real === v.degree };
  });

  for (const row of degrees) {
    if (!row.match) {
      issues.push({
        code: "DEGREE_MISMATCH",
        message: `顶点 ${row.id} 目标度数 ${row.target}，候选图实际度数 ${row.actual}`,
        vertex: row.id
      });
    }
  }

  return { valid: issues.length === 0, issues, degrees, edgeCount: deduped.length };
}

export function buildAdjacency(vertexIds: string[], edges: Edge[]): Record<string, string[]> {
  const adjacency: Record<string, string[]> = Object.fromEntries(vertexIds.map((id) => [id, []]));
  for (const { u, v } of edges) {
    adjacency[u]?.push(v);
    adjacency[v]?.push(u);
  }
  for (const id of vertexIds) {
    adjacency[id].sort();
  }
  return adjacency;
}

export { CandidateIssue };
