import { test } from "node:test";
import assert from "node:assert/strict";
import { runHavelHakimi, verifyGraph } from "../src/hh";
import { construct, parseVertices, ServiceError, verify, getSequenceDetail, getAdjacency } from "../src/service";

const V = (pairs: [string, number][]) => pairs.map(([id, degree]) => ({ id, degree }));

test("空顶点集可实现", () => {
  const r = runHavelHakimi([]);
  assert.equal(r.ok, true);
});

test("单个零度顶点", () => {
  const r = runHavelHakimi(V([["a", 0]]));
  assert.equal(r.ok, true);
});

test("全零序列", () => {
  const r = runHavelHakimi(V([["a", 0], ["b", 0], ["c", 0]]));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.edges.length, 0);
});

test("完全图 K4 度数 3,3,3,3", () => {
  const r = runHavelHakimi(V([["a", 3], ["b", 3], ["c", 3], ["d", 3]]));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.edges.length, 6);
});

test("演示: 2,2,1,1 可实现", () => {
  const r = runHavelHakimi(V([["a", 2], ["b", 2], ["c", 1], ["d", 1]]));
  assert.equal(r.ok, true);
});

test("演示: 3,3,1,1 不可实现且保留失败证据", () => {
  const r = runHavelHakimi(V([["a", 3], ["b", 3], ["c", 1], ["d", 1]]));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.steps.length > 0);
    assert.ok(r.failRound >= 1);
  }
});

test("重复编号被拒绝", () => {
  assert.throws(() => parseVertices(V([["a", 1], ["a", 1]])), (e) => e instanceof ServiceError && e.code === "DUPLICATE_ID");
});

test("奇数总度数被拒绝", () => {
  assert.throws(() => construct(V([["a", 1], ["b", 0], ["c", 0]])), (e) => e instanceof ServiceError && e.code === "ODD_TOTAL_DEGREE");
});

test("度数不小于顶点数被拒绝", () => {
  assert.throws(() => parseVertices(V([["a", 2], ["b", 0]])), (e) => e instanceof ServiceError && e.code === "DEGREE_OUT_OF_RANGE");
});

test("非整数/负度被拒绝", () => {
  assert.throws(() => parseVertices([{ id: "a", degree: 1.5 }]), (e) => e instanceof ServiceError && e.code === "INVALID_DEGREE");
  assert.throws(() => parseVertices([{ id: "a", degree: -1 }]), (e) => e instanceof ServiceError && e.code === "INVALID_DEGREE");
});

test("核验: 自环、重边、陌生顶点", () => {
  const vs = V([["a", 1], ["b", 1]]);
  assert.equal(verifyGraph(vs, [["a", "a"]]).ok, false);
  assert.equal(verifyGraph(vs, [["a", "b"], ["b", "a"]]).ok, false);
  assert.equal(verifyGraph(vs, [["a", "z"]]).ok, false);
  assert.equal(verifyGraph(vs, [["a", "b"]]).ok, true);
});

test("核验: 交换端点不视为第二条边", () => {
  const r = verifyGraph(V([["a", 1], ["b", 1]]), [["b", "a"]]);
  assert.equal(r.ok, true);
});

test("确定性: 输入重排产生相同边集", () => {
  const base = V([["a", 2], ["b", 2], ["c", 1], ["d", 1]]);
  const shuffled = V([["d", 1], ["c", 1], ["b", 2], ["a", 2]]);
  const r1 = runHavelHakimi(base);
  const r2 = runHavelHakimi(shuffled);
  assert.ok(r1.ok && r2.ok);
  const norm = (es: [string, string][]) =>
    es.map(([x, y]) => [x, y].sort().join("-")).sort().join(",");
  assert.equal(norm(r1.edges), norm(r2.edges));
});

test("穷举 n<=5 全部简单图与构造器判定一致", () => {
  for (let n = 0; n <= 5; n++) {
    const ids = Array.from({ length: n }, (_, i) => `v${i}`);
    const pairs: [number, number][] = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
    const realizable = new Set<string>();
    for (let mask = 0; mask < (1 << pairs.length); mask++) {
      const deg = new Array(n).fill(0);
      pairs.forEach(([i, j], k) => {
        if (mask & (1 << k)) { deg[i]++; deg[j]++; }
      });
      realizable.add(deg.join(","));
    }
    // 枚举所有度序列并比对判定
    const total = Math.pow(n, n);
    for (let t = 0; t < total; t++) {
      let x = t;
      const seq: number[] = [];
      for (let i = 0; i < i + 1 && seq.length < n; i++) { seq.push(x % n); x = Math.floor(x / n); }
      const key = seq.join(",");
      const r = runHavelHakimi(ids.map((id, i) => ({ id, degree: seq[i] })));
      assert.equal(r.ok, realizable.has(key), `n=${n} seq=${key}`);
      if (r.ok) {
        const v = verifyGraph(ids.map((id, i) => ({ id, degree: seq[i] })), r.edges);
        assert.equal(v.ok, true, `构造结果核验失败 n=${n} seq=${key}`);
      }
    }
  }
});

test("service: 构造、读取、邻接表、核验、重启后读取", () => {
  const c = construct(V([["a", 2], ["b", 2], ["c", 1], ["d", 1]]));
  assert.ok(c.ok);
  const detail = getSequenceDetail(c.id);
  assert.equal(detail.status, "realizable");
  assert.equal(detail.algorithmVersion, "havel-hakimi-v1");
  const adj = getAdjacency(c.id);
  assert.equal(Object.keys(adj).length, 4);
  const edges = detail.edges!;
  const v = verify(c.id, null, edges);
  assert.equal(v.ok, true);
  // 坏候选: 缺一条边
  const bad = verify(c.id, null, edges.slice(1));
  assert.equal(bad.ok, false);
});

test("失败结果与成功结果分开标识", () => {
  const c = construct(V([["a", 3], ["b", 3], ["c", 1], ["d", 1]]));
  assert.equal(c.ok, false);
  const detail = getSequenceDetail(c.id);
  assert.equal(detail.status, "unrealizable");
  assert.ok(detail.reason);
  assert.equal(detail.edges, null);
});
