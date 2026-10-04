import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before } from "node:test";
import { AddressInfo } from "node:net";
import { Store } from "../src/store";
import { GraphService } from "../src/service";
import { createApp } from "../src/server";
import { Server } from "node:http";

const dir = mkdtempSync(join(tmpdir(), "hh-"));
const dbPath = join(dir, "test.db");

const seq2211 = [
  { id: "1", degree: 2 },
  { id: "2", degree: 2 },
  { id: "3", degree: 1 },
  { id: "4", degree: 1 }
];

test("持久化：重启后仍可读取同一张图与报告", () => {
  let constructionId: number;
  {
    const store = new Store(dbPath);
    const service = new GraphService(store);
    const seq = service.createSequence(seq2211);
    const built = service.build(seq.id)!;
    constructionId = built.construction.id;
    assert.equal(built.construction.status, "success");
    store.close();
  }
  {
    const store = new Store(dbPath);
    const service = new GraphService(store);
    const adjacency = service.adjacency(constructionId)!;
    assert.deepEqual(adjacency.adjacency["1"].sort(), ["2", "3"]);
    const exported = service.exportConstruction(constructionId)!;
    assert.equal((exported.report as { status: string }).status, "success");
    assert.equal((exported.report as { edgeCount: number }).edgeCount, 3);
    store.close();
  }
});

test("版本：输入修改新建版本，旧版本不被重新解释", () => {
  const store = new Store(dbPath);
  const service = new GraphService(store);
  const seq = service.createSequence(seq2211);
  const v1 = service.build(seq.id)!;
  assert.equal(v1.construction.version, 1);
  // 修改序列目标度数 -> 新 sequence、新版本，旧数据不变。
  const changed = seq2211.map((x) => (x.id === "3" ? { ...x, degree: 3 } : x));
  const seq2 = service.createSequence(changed);
  const v2 = service.build(seq2.id)!;
  assert.notEqual(seq2.id, seq.id);
  assert.equal(v2.construction.version, 1);
  const rereadV1 = service.store.getConstruction(v1.construction.id)!;
  assert.equal(rereadV1.status, "success");
  assert.equal(rereadV1.edges.length, 3);
  store.close();
});

test("失败与成功分状态存储，失败记录无边", () => {
  const store = new Store(dbPath);
  const service = new GraphService(store);
  const seq = service.createSequence([
    { id: "1", degree: 3 },
    { id: "2", degree: 3 },
    { id: "3", degree: 1 },
    { id: "4", degree: 1 }
  ]);
  const built = service.build(seq.id)!;
  assert.equal(built.construction.status, "failure");
  assert.equal(built.construction.edges.length, 0);
  assert.ok((built.report as { rounds: unknown[] }).rounds.length >= 1);
  const versions = service.compareVersions(seq.id);
  assert.equal(versions[0].status, "failure");
  store.close();
});

let server: Server;
let base: string;

before(async () => {
  const store = new Store(join(dir, "http.db"));
  const service = new GraphService(store);
  server = createApp(service);
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
});

async function api(path: string, init?: RequestInit) {
  const response = await fetch(base + path, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init?.body
  });
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, json };
}

test("HTTP 全流程：创建、构造、步骤、邻接、核验、版本、导出", async () => {
  const health = await api("/health");
  assert.equal(health.status, 200);

  const created = await api("/sequences", {
    method: "POST",
    body: JSON.stringify({ vertices: seq2211 })
  });
  assert.equal(created.status, 200);
  const seqId = (created.json as { id: number }).id;

  const built = await api(`/sequences/${seqId}/construct`, { method: "POST", body: "{}" });
  assert.equal(built.status, 200);
  const constructionId = (built.json as { construction: { id: number } }).construction.id;
  assert.equal((built.json as { report: { status: string } }).report.status, "success");

  const steps = await api(`/constructions/${constructionId}/steps`);
  assert.equal(steps.status, 200);
  assert.ok(((steps.json as { rounds: unknown[] }).rounds.length > 0));

  const adjacency = await api(`/constructions/${constructionId}/adjacency`);
  assert.equal(adjacency.status, 200);

  const goodCandidate = await api(`/sequences/${seqId}/verify`, {
    method: "POST",
    body: JSON.stringify({
      edges: [
        { u: "1", v: "2" },
        { u: "3", v: "1" },
        { u: "4", v: "2" }
      ]
    })
  });
  assert.equal(goodCandidate.status, 200);
  assert.equal((goodCandidate.json as { result: { valid: boolean } }).result.valid, true);

  const badCandidate = await api(`/sequences/${seqId}/verify`, {
    method: "POST",
    body: JSON.stringify({ edges: [{ u: "1", v: "1" }] })
  });
  assert.equal((badCandidate.json as { result: { valid: boolean } }).result.valid, false);

  const versions = await api(`/sequences/${seqId}/versions`);
  assert.equal(versions.status, 200);

  const exported = await api(`/constructions/${constructionId}/export`);
  assert.equal(exported.status, 200);
});

test("HTTP：格式错误返回 400 与错误码；不可实现仍是 200 的 failure 报告", async () => {
  const bad = await api("/sequences", {
    method: "POST",
    body: JSON.stringify({ vertices: [{ id: "x", degree: -2 }] })
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, "NEGATIVE_DEGREE");

  const duplicate = await api("/sequences", {
    method: "POST",
    body: JSON.stringify({ vertices: [{ id: "x", degree: 0 }, { id: "x", degree: 0 }] })
  });
  assert.equal(duplicate.json.error, "DUPLICATE_ID");

  const created = await api("/sequences", {
    method: "POST",
    body: JSON.stringify({
      vertices: [
        { id: "1", degree: 3 },
        { id: "2", degree: 3 },
        { id: "3", degree: 1 },
        { id: "4", degree: 1 }
      ]
    })
  });
  const seqId = (created.json as { id: number }).id;
  const built = await api(`/sequences/${seqId}/construct`, { method: "POST", body: "{}" });
  assert.equal(built.status, 200);
  assert.equal((built.json as { report: { status: string } }).report.status, "failure");
});
