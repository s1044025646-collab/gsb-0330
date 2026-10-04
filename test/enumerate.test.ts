import { test } from "node:test";
import assert from "node:assert/strict";
import { construct } from "../src/havel";
import { verifyCandidate } from "../src/verify";

/**
 * 独立枚举：对 n 个带编号顶点枚举全部 2^(n choose 2) 张简单图，
 * 收集实际出现过度序列（按编号归一）。构造器判定必须与“是否存在该图”一致。
 */
function realizableSequences(n: number): Set<string> {
  const ids = Array.from({ length: n }, (_, i) => String(i + 1));
  const possible: [string, string][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) possible.push([ids[i], ids[j]]);
  }
  const found = new Set<string>();
  const total = 2 ** possible.length;
  for (let mask = 0; mask < total; mask++) {
    const degree = new Map(ids.map((id) => [id, 0]));
    for (let k = 0; k < possible.length; k++) {
      if ((mask >> k) & 1) {
        const [u, v] = possible[k];
        degree.set(u, degree.get(u)! + 1);
        degree.set(v, degree.get(v)! + 1);
      }
    }
    // 以“编号:度”排序后的序列作为集合键，保留编号身份。
    const key = ids.map((id) => `${id}:${degree.get(id)}`).join(",");
    found.add(key);
  }
  return found;
}

for (let n = 0; n <= 5; n++) {
  test(`n=${n}：枚举全部简单图与构造器判定一致并逐边复算`, () => {
    const graphSequences = realizableSequences(n);
    // 枚举所有度向量（每分量 0..n-1），总度偶数的才可能出现，直接让构造器判定。
    const vectors: number[][] = [[]];
    for (let i = 0; i < n; i++) {
      const next: number[][] = [];
      for (const prefix of vectors) {
        for (let d = 0; d < n; d++) next.push([...prefix, d]);
      }
      vectors.length = 0;
      vectors.push(...next);
    }
    for (const vec of vectors) {
      const vertices = vec.map((degree, i) => ({ id: String(i + 1), degree }));
      const key = vertices.map((x) => `${x.id}:${x.degree}`).join(",");
      const exists = graphSequences.has(key);
      const result = construct(vertices);
      assert.equal(
        result.realizable,
        exists,
        `序列 ${key}：枚举存在性=${exists}，构造器=${result.realizable}`
      );
      if (result.realizable) {
        const check = verifyCandidate(vertices, result.edges);
        assert.ok(check.valid, `构造出的图逐边复算失败: ${JSON.stringify(check.issues)}`);
        assert.equal(result.edges.length, vec.reduce((a, b) => a + b, 0) / 2);
      }
    }
  });
}
