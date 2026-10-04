import {
  ConstructFailure,
  ConstructResult,
  Edge,
  InputVertex,
  LIMITS,
  RoundRecord,
  ValidationError
} from "./types";

/**
 * 平局规则使用的固定编号比较：
 * 优先保证形如 "1"、"2"、"10" 的编号按数值顺序，其余退化为字典序。
 * 不依赖数组下标，结果只由编号与度数决定。
 */
export function compareId(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  const bothNumeric = a.trim() !== "" && b.trim() !== "" && Number.isFinite(na) && Number.isFinite(nb);
  if (bothNumeric && Number.isSafeInteger(na) && Number.isSafeInteger(nb) && String(na) === a && String(nb) === b) {
    return Math.sign(na - nb);
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 只做格式校验：结构、非负整数、编号重复、数量上限。不做图论可实现性判断。 */
export function validateInput(input: unknown): InputVertex[] {
  if (!Array.isArray(input)) {
    throw new ValidationError("INVALID_BODY", "vertices 必须是数组");
  }
  if (input.length > LIMITS.MAX_VERTICES) {
    throw new ValidationError(
      "TOO_MANY_VERTICES",
      `顶点数 ${input.length} 超过上限 ${LIMITS.MAX_VERTICES}`
    );
  }
  const vertices: InputVertex[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    if (typeof raw !== "object" || raw === null) {
      throw new ValidationError("INVALID_VERTEX", `第 ${i + 1} 个顶点不是对象`, { index: i });
    }
    const { id, degree } = raw as { id?: unknown; degree?: unknown };
    if (typeof id !== "string" || id.length === 0) {
      throw new ValidationError("INVALID_ID", `第 ${i + 1} 个顶点的 id 必须是非空字符串`, { index: i });
    }
    if (typeof degree !== "number" || !Number.isInteger(degree)) {
      throw new ValidationError("INVALID_DEGREE", `顶点 ${id} 的度数必须是整数`, { id });
    }
    if (degree < 0) {
      throw new ValidationError("NEGATIVE_DEGREE", `顶点 ${id} 的度数不能为负`, { id, degree });
    }
    if (seen.has(id)) {
      throw new ValidationError("DUPLICATE_ID", `顶点编号重复：${id}`, { id });
    }
    seen.add(id);
    vertices.push({ id, degree });
  }
  return vertices;
}

function cloneResidual(residual: Map<string, number>): Record<string, number> {
  return Object.fromEntries(residual.entries());
}

/**
 * 自行实现的 Havel–Hakimi 消减。
 * 前置检查（度 < 顶点数、总度数为偶数）属于“合法输入但不可实现”，
 * 返回 realizable:false 而不是抛格式错误。
 */
export function construct(vertices: InputVertex[]): ConstructResult {
  const n = vertices.length;
  const residual = new Map<string, number>(vertices.map((v) => [v.id, v.degree]));
  const edges: Edge[] = [];
  const rounds: RoundRecord[] = [];

  // 前置检查 1：简单图中任一顶点度数必须小于顶点数。
  for (const v of vertices) {
    if (v.degree >= n) {
      return {
        realizable: false,
        reasonCode: "DEGREE_EXCEEDS_MAX",
        message: `顶点 ${v.id} 的目标度数 ${v.degree} 不小于顶点数 ${n}，简单图中最多只能与 ${Math.max(0, n - 1)} 个顶点相连`,
        failedRound: 0,
        pivot: v.id,
        pivotDegree: v.degree,
        rounds: [],
        residualAtFailure: cloneResidual(residual)
      } satisfies ConstructFailure;
    }
  }

  // 前置检查 2：总度数必须为偶数（握手引理），仅为必要条件。
  const total = vertices.reduce((sum, v) => sum + v.degree, 0);
  if (total % 2 !== 0) {
    return {
      realizable: false,
      reasonCode: "SUM_ODD",
      message: `总度数 ${total} 为奇数，任何无向图的度数之和都必须为偶数`,
      failedRound: 0,
      rounds: [],
      residualAtFailure: cloneResidual(residual)
    } satisfies ConstructFailure;
  }

  if (rounds.length >= LIMITS.MAX_STEPS) {
    throw new ValidationError("TOO_MANY_STEPS", "消减轮数超过上限，拒绝构造（不截断结果）");
  }

  while (true) {
    // 每轮重新按剩余度降序、平局按固定编号升序排列。
    const ordered = [...residual.entries()]
      .map(([id, r]) => ({ id, residual: r }))
      .sort((a, b) => b.residual - a.residual || compareId(a.id, b.id));

    const pivotEntry = ordered[0];
    // 空顶点集或全部剩余度为零：成功（空顶点集是合法输入）。
    if (!pivotEntry || pivotEntry.residual === 0) {
      return {
        realizable: true,
        edges,
        rounds,
        finalResidual: cloneResidual(residual)
      };
    }

    if (rounds.length + 1 > LIMITS.MAX_STEPS) {
      throw new ValidationError(
        "TOO_MANY_STEPS",
        `消减轮数超过上限 ${LIMITS.MAX_STEPS}，拒绝构造（不截断结果）`
      );
    }
    if (edges.length > LIMITS.MAX_EDGES) {
      throw new ValidationError(
        "TOO_MANY_EDGES",
        `边数超过上限 ${LIMITS.MAX_EDGES}，拒绝构造（不截断边列表）`
      );
    }

    const d = pivotEntry.residual;
    const pivot = pivotEntry.id;
    const candidates = ordered.slice(1).filter((x) => x.residual > 0);

    // 消减后若出现负剩余度，等价于剩余正度顶点数量不足。
    if (candidates.length < d) {
      const roundIndex = rounds.length + 1;
      return {
        realizable: false,
        reasonCode: "INSUFFICIENT_NEIGHBORS",
        message: `第 ${roundIndex} 轮：顶点 ${pivot} 还需连接 ${d} 个顶点，但剩余正度顶点只有 ${candidates.length} 个，无法在无重边的简单图中完成`,
        failedRound: roundIndex,
        pivot,
        pivotDegree: d,
        availableNeighbors: candidates.length,
        rounds,
        residualAtFailure: cloneResidual(residual)
      } satisfies ConstructFailure;
    }

    const neighbors = candidates.slice(0, d);
    const residualBefore = cloneResidual(residual);
    const edgesAdded: Edge[] = [];

    residual.set(pivot, 0);
    for (const nb of neighbors) {
      edgesAdded.push({ u: pivot, v: nb.id });
      edges.push({ u: pivot, v: nb.id });
      const next = residual.get(nb.id)! - 1;
      if (next < 0) {
        residual.set(nb.id, next);
        const roundIndex = rounds.length + 1;
        return {
          realizable: false,
          reasonCode: "NEGATIVE_RESIDUAL",
          message: `第 ${roundIndex} 轮：顶点 ${nb.id} 消减后剩余度为负`,
          failedRound: roundIndex,
          pivot: nb.id,
          rounds,
          residualAtFailure: cloneResidual(residual)
        } satisfies ConstructFailure;
      }
      residual.set(nb.id, next);
    }

    rounds.push({
      round: rounds.length + 1,
      sortedBefore: ordered,
      pivot,
      pivotDegree: d,
      neighbors: neighbors.map((x) => x.id),
      edgesAdded,
      residualBefore,
      residualAfter: cloneResidual(residual)
    });
  }
}

/** 边的规范化存储：按编号排序，保证 {u,v} 与 {v,u} 视为同一条无向边。 */
export function canonicalEdge(u: string, v: string): Edge {
  return compareId(u, v) <= 0 ? { u, v } : { u: v, v: u };
}

export function edgeKey(edge: Edge): string {
  const c = canonicalEdge(edge.u, edge.v);
  return `${c.u}${c.v}`;
}
