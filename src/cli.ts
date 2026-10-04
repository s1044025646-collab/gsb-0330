import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { construct, validateInput } from "./havel";
import { buildAdjacency, verifyCandidate } from "./verify";
import { RoundRecord, InputVertex, Edge, ALGORITHM_VERSION } from "./types";
import { GraphService } from "./service";
import { Store, TIE_RULE } from "./store";
import { createApp } from "./server";

const DATA_DIR = process.env.HH_DATA_DIR ? resolve(process.env.HH_DATA_DIR) : resolve(process.cwd(), "data");

function readJsonArg(value: string): unknown {
  const text = value.startsWith("@")
    ? readFileSync(resolve(value.slice(1)), "utf8")
    : value;
  return JSON.parse(text);
}

function divider(ch: string, n = 64) {
  return ch.repeat(n);
}

function printRounds(rounds: RoundRecord[]) {
  console.log(divider("="));
  console.log("消减过程（编号均为原顶点稳定编号）");
  console.log(divider("="));
  if (rounds.length === 0) {
    console.log("（无需消减：输入为空集或全部目标度数为 0）");
    return;
  }
  for (const r of rounds) {
    const order = r.sortedBefore.map((x) => `${x.id}(${x.residual})`).join(", ");
    console.log(`第 ${r.round} 轮`);
    console.log(`  排序后: ${order}`);
    console.log(`  选中:   顶点 ${r.pivot}，剩余度 ${r.pivotDegree}`);
    console.log(`  连接:   ${r.neighbors.join(", ")}`);
    console.log(`  新增边: ${r.edgesAdded.map((e) => `${e.u}--${e.v}`).join(", ")}`);
    const after = r.neighbors
      .map((id) => `${id}: ${r.residualBefore[id]} -> ${r.residualAfter[id]}`)
      .join("; ");
    console.log(`  消减:   ${r.pivot}: ${r.pivotDegree} -> 0; ${after}`);
  }
}

function printAdjacency(vertices: InputVertex[], edges: Edge[]) {
  const adjacency = buildAdjacency(
    vertices.map((v) => v.id),
    edges
  );
  console.log(divider("="));
  console.log("邻接表");
  console.log(divider("="));
  for (const vertex of vertices) {
    const neighbors = adjacency[vertex.id];
    console.log(`  ${vertex.id} (目标 ${vertex.degree}, 实际 ${neighbors.length}): ${neighbors.length ? neighbors.join(", ") : "（孤立）"}`);
  }
}

function runDemoOnce(label: string, rawVertices: unknown) {
  console.log("\n" + "#".repeat(64));
  console.log(`# 演示：${label}`);
  console.log("#".repeat(64));
  const vertices = validateInput(rawVertices);
  console.log(`平局规则: ${TIE_RULE}`);
  console.log(`算法版本: ${ALGORITHM_VERSION}`);
  const result = construct(vertices);
  printRounds(result.rounds);
  if (result.realizable) {
    console.log("\n结论: 可实现 ✅");
    console.log(`边数: ${result.edges.length}`);
    const verification = verifyCandidate(vertices, result.edges);
    printAdjacency(vertices, result.edges);
    console.log("独立核验: " + (verification.valid ? "通过 ✅（逐边复算度数一致）" : "未通过 ❌"));
    console.table(
      verification.degrees.map((d) => ({
        顶点: d.id,
        目标度数: d.target,
        实际度数: d.actual,
        一致: d.match ? "是" : "否"
      }))
    );
  } else {
    console.log("\n结论: 不可实现 ❌");
    console.log(`失败原因 [${result.reasonCode}]: ${result.message}`);
    console.log("保留消减过程与失败时剩余度，不输出缺边图：");
    console.log(result.residualAtFailure);
  }
}

function demo() {
  runDemoOnce("可实现 2,2,1,1", [
    { id: "1", degree: 2 },
    { id: "2", degree: 2 },
    { id: "3", degree: 1 },
    { id: "4", degree: 1 }
  ]);
  runDemoOnce("范围合法且总度偶数但不可实现 3,3,1,1", [
    { id: "1", degree: 3 },
    { id: "2", degree: 3 },
    { id: "3", degree: 1 },
    { id: "4", degree: 1 }
  ]);
}

function withStore<T>(fn: (service: GraphService, store: Store) => T): T {
  const store = new Store(resolve(DATA_DIR, "havel.db"));
  const service = new GraphService(store);
  try {
    return fn(service, store);
  } finally {
    store.close();
  }
}

function parseVertices(args: string[]): unknown[] {
  const vertices: unknown[] = [];
  for (const arg of args) {
    if (arg.includes("=") && !arg.startsWith("{")) {
      const [id, degree] = arg.split("=");
      vertices.push({ id, degree: Number(degree) });
    } else {
      const parsed = readJsonArg(arg.startsWith("@") ? arg : `@${arg}`) as
        | { vertices?: unknown }
        | unknown[];
      const list = Array.isArray(parsed) ? parsed : parsed.vertices;
      if (Array.isArray(list)) vertices.push(...list);
    }
  }
  return vertices;
}

function usage() {
  console.log(
    [
      "Havel–Hakimi 度序列构图 CLI",
      "",
      "用法:",
      "  node dist/cli.js demo",
      "  node dist/cli.js serve [--port PORT]",
      "  node dist/cli.js create <id=度 ...> | <vertices.json>",
      "  node dist/cli.js construct <sequenceId>",
      "  node dist/cli.js steps <constructionId>",
      "  node dist/cli.js adjacency <constructionId>",
      "  node dist/cli.js verify <sequenceId> <edges.json>",
      "  node dist/cli.js versions <sequenceId>",
      "  node dist/cli.js export <constructionId>",
      "",
      "环境变量:",
      "  PORT           HTTP 端口，默认 0（由系统分配空闲端口）",
      "  HH_DATA_DIR    数据目录，默认 ./data"
    ].join("\n")
  );
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "demo":
      demo();
      break;
    case "serve": {
      const portIdx = rest.indexOf("--port");
      if (portIdx >= 0) process.env.PORT = rest[portIdx + 1];
      const store = new Store(resolve(DATA_DIR, "havel.db"));
      const service = new GraphService(store);
      const server = createApp(service);
      const port = process.env.PORT ? Number(process.env.PORT) : 0;
      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        const actual = typeof address === "object" && address ? address.port : port;
        console.log(`服务已启动: http://127.0.0.1:${actual}（数据目录 ${DATA_DIR}）`);
      });
      break;
    }
    case "create": {
      const vertices = parseVertices(rest);
      withStore((service) => {
        const seq = service.createSequence(vertices);
        console.log("已创建序列：");
        console.log(JSON.stringify(seq, null, 2));
      });
      break;
    }
    case "construct":
      withStore((service) => {
        const output = service.build(Number(rest[0]));
        if (!output) throw new Error("序列不存在");
        console.log(JSON.stringify(output.report, null, 2));
        console.log(
          `constructionId=${output.construction.id} version=${output.construction.version} status=${output.construction.status}`
        );
      });
      break;
    case "steps":
      withStore((service) => {
        const row = service.store.getConstruction(Number(rest[0]));
        if (!row) throw new Error("构造不存在");
        printRounds(row.rounds as RoundRecord[]);
      });
      break;
    case "adjacency":
      withStore((service) => {
        const output = service.adjacency(Number(rest[0]));
        if (!output) throw new Error("构造不存在");
        console.log(JSON.stringify(output, null, 2));
      });
      break;
    case "verify": {
      withStore((service) => {
        const seqId = Number(rest[0]);
        const payload = readJsonArg(rest[1].startsWith("@") ? rest[1] : `@${rest[1]}`) as
          | { edges?: unknown }
          | unknown[];
        const edges = Array.isArray(payload) ? payload : payload.edges;
        const output = service.importCandidate(seqId, edges);
        if (!output) throw new Error("序列不存在");
        console.log(JSON.stringify(output.result, null, 2));
      });
      break;
    }
    case "versions":
      withStore((service) => {
        console.table(service.compareVersions(Number(rest[0])));
      });
      break;
    case "export":
      withStore((service) => {
        const output = service.exportConstruction(Number(rest[0]));
        if (!output) throw new Error("构造不存在");
        console.log(JSON.stringify(output, null, 2));
      });
      break;
    default:
      usage();
      if (command) process.exitCode = 1;
  }
}

try {
  main();
} catch (err) {
  console.error("错误：" + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
}
