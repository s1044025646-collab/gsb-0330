import { test } from "node:test";
import assert from "node:assert/strict";
import { construct, validateInput } from "../src/havel";
import { verifyCandidate, buildAdjacency } from "../src/verify";
import { ValidationError } from "../src/types";

function v(degrees: number[]) {
  return degrees.map((degree, i) => ({ id: String(i + 1), degree }));
}

function expectRealizable(degrees: number[]) {
  const vertices = v(degrees);
  const result = construct(vertices);
  assert.equal(result.realizable, true, `应可实现: ${degrees}（${(result as { message?: string }).message ?? ""}）`);
  if (result.realizable) {
    const check = verifyCandidate(vertices, result.edges);
    assert.ok(check.valid, `构造图自检应通过: ${JSON.stringify(check.issues)}`);
    assert.equal(result.edges.length * 2, degrees.reduce((a, b) => a + b, 0));
  }
  return result;
}

function expectNotRealizable(degrees: number[], code?: string) {
  const result = construct(v(degrees));
  assert.equal(result.realizable, false, `不应可实现: ${degrees}`);
  if (!result.realizable && code) assert.equal(result.reasonCode, code);
  return result;
}

test("空顶点集可实现且无边", () => {
  const result = construct([]);
  assert.ok(result.realizable);
  if (result.realizable) assert.deepEqual(result.edges, []);
});

test("单个零度顶点与全零序列", () => {
  for (const degrees of [[0], [0, 0, 0], [0, 0, 0, 0, 0]]) {
    const result = expectRealizable(degrees);
    if (result.realizable) {
      assert.equal(result.rounds.length, 0);
      assert.deepEqual(buildAdjacency(v(degrees).map((x) => x.id), result.edges),
        Object.fromEntries(v(degrees).map((x) => [x.id, []])));
    }
  }
});

test("演示序列 2,2,1,1 可实现", () => {
  const result = expectRealizable([2, 2, 1, 1]);
  if (result.realizable) {
    assert.equal(result.edges.length, 3);
    const pairs = result.edges.map((e) => [e.u, e.v].sort().join("-")).sort();
    assert.deepEqual(pairs, ["1-2", "1-3", "2-4"]);
  }
});

test("3,3,1,1 范围合法且总度偶数，但不可实现", () => {
  const result = expectNotRealizable([3, 3, 1, 1]);
  if (!result.realizable) {
    assert.ok(result.rounds.length >= 1, "应保留消减到失败的过程");
    assert.equal(result.failedRound, result.rounds.length + 1);
  }
});

test("完全图度数 n-1 可实现", () => {
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    expectRealizable(Array(n).fill(n - 1));
  }
});

test("奇数总度数不可实现（SUM_ODD），区别于格式错误", () => {
  expectNotRealizable([1, 1, 1], "SUM_ODD");
  expectNotRealizable([3, 1, 1, 0], "SUM_ODD");
});

test("度数达到顶点数被判 DEGREE_EXCEEDS_MAX", () => {
  expectNotRealizable([4, 0, 0, 0], "DEGREE_EXCEEDS_MAX");
  expectNotRealizable([3, 0, 0], "DEGREE_EXCEEDS_MAX");
});

test("编号重复是格式错误 DUPLICATE_ID", () => {
  assert.throws(
    () => validateInput([{ id: "a", degree: 1 }, { id: "a", degree: 1 }]),
    (err: unknown) => err instanceof ValidationError && err.code === "DUPLICATE_ID"
  );
});

test("负度数与非整数是格式错误", () => {
  assert.throws(() => validateInput([{ id: "a", degree: -1 }]), (e: unknown) => (e as ValidationError).code === "NEGATIVE_DEGREE");
  assert.throws(() => validateInput([{ id: "a", degree: 1.5 }]), (e: unknown) => (e as ValidationError).code === "INVALID_DEGREE");
  assert.throws(() => validateInput([{ id: "", degree: 0 }]), (e: unknown) => (e as ValidationError).code === "INVALID_ID");
});

test("输入行重排（编号与度数不变）得到完全相同的边集与消减", () => {
  const a = [{ id: "1", degree: 2 }, { id: "2", degree: 2 }, { id: "3", degree: 1 }, { id: "4", degree: 1 }];
  const b = [a[3], a[1], a[2], a[0]];
  const ra = construct(a);
  const rb = construct(b);
  assert.ok(ra.realizable && rb.realizable);
  if (ra.realizable && rb.realizable) {
    const keyOf = (edges: { u: string; v: string }[]) =>
      edges.map((e) => [e.u, e.v].sort().join("-")).sort();
    assert.deepEqual(keyOf(rb.edges), keyOf(ra.edges));
    assert.deepEqual(rb.rounds.map((r) => [r.pivot, r.neighbors]), ra.rounds.map((r) => [r.pivot, r.neighbors]));
  }
});

test("失败结果不产出任何边", () => {
  const result = construct(v([3, 3, 3, 1]));
  assert.equal(result.realizable, false);
});

test("候选核验：自环、重复边（含交换端点）、陌生顶点、度数不符", () => {
  const vertices = v([2, 2, 1, 1]);
  assert.ok(verifyCandidate(vertices, [{ u: "1", v: "1" }]).issues.some((i) => i.code === "SELF_LOOP"));
  const dup = verifyCandidate(vertices, [
    { u: "1", v: "2" },
    { u: "2", v: "1" },
    { u: "1", v: "3" },
    { u: "2", v: "4" }
  ]);
  assert.ok(dup.issues.some((i) => i.code === "DUPLICATE_EDGE"));
  assert.ok(verifyCandidate(vertices, [{ u: "1", v: "9" }]).issues.some((i) => i.code === "UNKNOWN_VERTEX"));
  const mismatch = verifyCandidate(vertices, [
    { u: "1", v: "2" },
    { u: "1", v: "3" }
  ]);
  assert.ok(mismatch.issues.some((i) => i.code === "DEGREE_MISMATCH"));
  assert.equal(mismatch.valid, false);
});

test("核验不信任附带统计：正确图通过且零度顶点仍在度表中", () => {
  const vertices = [{ id: "a", degree: 0 }, { id: "b", degree: 0 }, { id: "c", degree: 0 }];
  const result = verifyCandidate(vertices, []);
  assert.ok(result.valid);
  assert.equal(result.degrees.length, 3);
  assert.deepEqual(result.degrees.map((d) => d.actual), [0, 0, 0]);
});
