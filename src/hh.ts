import { ConstructResult, StepRecord, VertexInput } from "./types";

export function cmpVertex(a: VertexInput, b: VertexInput): number {
  if (b.degree !== a.degree) return b.degree - a.degree;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function runHavelHakimi(vertices: VertexInput[]): ConstructResult {
  const remaining = vertices.map((v) => ({ id: v.id, degree: v.degree }));
  const edges: [string, string][] = [];
  const steps: StepRecord[] = [];
  let round = 0;

  while (true) {
    remaining.sort(cmpVertex);
    if (remaining.every((v) => v.degree === 0)) {
      return { ok: true, edges, steps };
    }
    round += 1;
    const sortedBefore = remaining.map((v) => ({ ...v }));
    const head = remaining[0];
    const d = head.degree;
    if (d > remaining.length - 1) {
      return {
        ok: false,
        reason: `顶点 ${head.id} 剩余度 ${d} 超过可用邻居数 ${remaining.length - 1}`,
        steps,
        failRound: round,
      };
    }
    const neighbors: string[] = [];
    for (let i = 1; i <= d; i++) {
      const nb = remaining[i];
      nb.degree -= 1;
      neighbors.push(nb.id);
      edges.push([head.id, nb.id]);
      if (nb.degree < 0) {
        steps.push({
          round,
          sortedBefore,
          selected: head.id,
          selectedDegree: d,
          neighbors,
          sortedAfter: remaining.map((v) => ({ ...v })),
        });
        return {
          ok: false,
          reason: `顶点 ${nb.id} 剩余度降为负数`,
          steps,
          failRound: round,
        };
      }
    }
    head.degree = 0;
    steps.push({
      round,
      sortedBefore,
      selected: head.id,
      selectedDegree: d,
      neighbors,
      sortedAfter: remaining.map((v) => ({ ...v })),
    });
  }
}

export interface VerifyResult {
  ok: boolean;
  errors: string[];
  degrees?: { id: string; target: number; actual: number }[];
  edgeCount?: number;
}

export function verifyGraph(
  vertices: VertexInput[],
  edges: [string, string][]
): VerifyResult {
  const errors: string[] = [];
  const idSet = new Set(vertices.map((v) => v.id));
  const seen = new Set<string>();
  const actual = new Map<string, number>(vertices.map((v) => [v.id, 0]));

  edges.forEach(([a, b], i) => {
    if (!idSet.has(a)) errors.push(`边 ${i}: 陌生顶点 ${a}`);
    if (!idSet.has(b)) errors.push(`边 ${i}: 陌生顶点 ${b}`);
    if (a === b) errors.push(`边 ${i}: 自环 ${a}`);
    const key = a < b ? `${a}${b}` : `${b}${a}`;
    if (seen.has(key)) errors.push(`边 ${i}: 重复无向边 ${a}-${b}`);
    seen.add(key);
    if (idSet.has(a) && idSet.has(b) && a !== b) {
      actual.set(a, (actual.get(a) ?? 0) + 1);
      actual.set(b, (actual.get(b) ?? 0) + 1);
    }
  });

  const degrees = vertices.map((v) => ({
    id: v.id,
    target: v.degree,
    actual: actual.get(v.id) ?? 0,
  }));
  for (const d of degrees) {
    if (d.target !== d.actual) {
      errors.push(`顶点 ${d.id}: 目标度 ${d.target} 实际度 ${d.actual}`);
    }
  }
  return { ok: errors.length === 0, errors, degrees, edgeCount: edges.length };
}
