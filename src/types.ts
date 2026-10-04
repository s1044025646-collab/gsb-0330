export const ALGORITHM_VERSION = "hh-1.0.0";

/** 服务端限制（超限在构造前整体拒绝，不截断）。 */
export const LIMITS = {
  MAX_VERTICES: 500,
  MAX_EDGES: 10000,
  MAX_STEPS: 5000,
  MAX_CANDIDATE_EDGES: 10000
} as const;

export interface InputVertex {
  id: string;
  degree: number;
}

export interface Edge {
  u: string;
  v: string;
}

/** 输入格式错误（输入本身不合法）。 */
export class ValidationError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
    this.details = details;
  }
}

/** 一轮消减的完整记录，全部使用原顶点编号。 */
export interface RoundRecord {
  round: number;
  /** 本轮消减前按（剩余度降序，编号升序）排列的顶点。 */
  sortedBefore: { id: string; residual: number }[];
  /** 被选中的最大剩余度顶点。 */
  pivot: string;
  pivotDegree: number;
  /** 被连接的 d 个邻居（稳定编号顺序），不足时为实际可用数量。 */
  neighbors: string[];
  /** 本轮实际新增的边。 */
  edgesAdded: Edge[];
  /** 消减前后各顶点剩余度（仅记录发生变化或参与本轮的顶点，以及 pivot）。 */
  residualBefore: Record<string, number>;
  residualAfter: Record<string, number>;
}

export interface ConstructSuccess {
  realizable: true;
  edges: Edge[];
  rounds: RoundRecord[];
  finalResidual: Record<string, number>;
}

export interface ConstructFailure {
  realizable: false;
  /** 失败类型：必要条件不满足或消减过程中失败。 */
  reasonCode:
    | "SUM_ODD"
    | "DEGREE_EXCEEDS_MAX"
    | "NEGATIVE_RESIDUAL"
    | "INSUFFICIENT_NEIGHBORS";
  message: string;
  /** 失败发生的轮次；前置检查失败为 0。 */
  failedRound: number;
  /** 导致失败的顶点（如 pivot）。 */
  pivot?: string;
  pivotDegree?: number;
  availableNeighbors?: number;
  /** 到失败为止已完成的消减记录（保留过程，不回填为成功）。 */
  rounds: RoundRecord[];
  residualAtFailure: Record<string, number>;
}

export type ConstructResult = ConstructSuccess | ConstructFailure;

export interface DegreeRow {
  id: string;
  target: number;
  actual: number;
  match: boolean;
}

export interface CandidateIssue {
  code:
    | "UNKNOWN_VERTEX"
    | "SELF_LOOP"
    | "DUPLICATE_EDGE"
    | "DEGREE_MISMATCH"
    | "MISSING_VERTEX";
  message: string;
  edge?: Edge;
  vertex?: string;
}

export interface VerifyResult {
  valid: boolean;
  issues: CandidateIssue[];
  degrees: DegreeRow[];
  edgeCount: number;
}
