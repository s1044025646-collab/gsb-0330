export interface VertexInput {
  id: string;
  degree: number;
}

export interface StepRecord {
  round: number;
  sortedBefore: VertexInput[];
  selected: string;
  selectedDegree: number;
  neighbors: string[];
  sortedAfter: VertexInput[];
}

export type ConstructResult =
  | { ok: true; edges: [string, string][]; steps: StepRecord[] }
  | { ok: false; reason: string; steps: StepRecord[]; failRound: number };

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export const LIMITS = {
  MAX_VERTICES: 200,
  MAX_EDGES: 5000,
  MAX_STEPS_STORED: 1000,
};

export const ALGORITHM_VERSION = "havel-hakimi-v1";
export const TIE_BREAK_RULE = "degree-desc-then-id-asc";
