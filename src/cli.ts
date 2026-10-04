import { construct, exportSequence, getAdjacency, getSequenceDetail, verify } from "./service";
import { listSequences } from "./db";

function printSteps(steps: {
  round: number;
  sortedBefore: { id: string; degree: number }[];
  selected: string;
  selectedDegree: number;
  neighbors: string[];
  sortedAfter: { id: string; degree: number }[];
}[]) {
  const fmt = (list: { id: string; degree: number }[]) =>
    list.map((v) => `${v.id}:${v.degree}`).join(" ");
  for (const s of steps) {
    console.log(`轮次 ${s.round}`);
    console.log(`  排序前: ${fmt(s.sortedBefore)}`);
    console.log(`  选中: ${s.selected} (剩余度 ${s.selectedDegree}) -> 邻居: ${s.neighbors.join(", ")}`);
    console.log(`  消减后: ${fmt(s.sortedAfter)}`);
  }
}

function printAdjacency(adj: Record<string, string[]>) {
  for (const [id, nbs] of Object.entries(adj)) {
    console.log(`  ${id}: ${nbs.join(", ") || "(孤立)"}`);
  }
}

function cmdConstruct(args: string[]) {
  // 用法: cli construct id:deg id:deg ...
  const vertices = args.map((pair) => {
    const [id, deg] = pair.split(":");
    return { id, degree: Number(deg) };
  });
  const result = construct(vertices);
  console.log(`序列 ID: ${result.id} 状态: ${result.ok ? "可实现" : "不可实现"}`);
  if (!result.ok) console.log(`失败原因: ${result.reason} (第 ${result.failRound} 轮)`);
  printSteps(result.steps);
  if (result.ok) {
    console.log("邻接表:");
    printAdjacency(getAdjacency(result.id));
  }
}

function cmdDemo() {
  console.log("=== 演示 1: 2,2,1,1 (可实现) ===");
  cmdConstruct(["a:2", "b:2", "c:1", "d:1"]);
  console.log("\n=== 演示 2: 3,3,1,1 (不可实现) ===");
  cmdConstruct(["a:3", "b:3", "c:1", "d:1"]);
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "construct":
      return cmdConstruct(args);
    case "demo":
      return cmdDemo();
    case "list":
      return console.log(JSON.stringify(listSequences(), null, 2));
    case "steps": {
      const d = getSequenceDetail(Number(args[0]));
      return printSteps(d.steps);
    }
    case "adjacency":
      return printAdjacency(getAdjacency(Number(args[0])));
    case "export":
      return console.log(JSON.stringify(exportSequence(Number(args[0])), null, 2));
    case "verify": {
      // 用法: cli verify <sequenceId> a-b a-b ...
      const seqId = Number(args[0]);
      const edges = args.slice(1).map((p) => p.split("-") as [string, string]);
      const r = verify(seqId, null, edges);
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    default:
      console.log(`用法:
  node dist/src/cli.js construct a:2 b:2 c:1 d:1   构造度序列
  node dist/src/cli.js demo                        运行两个演示
  node dist/src/cli.js list                        列出全部序列
  node dist/src/cli.js steps <id>                  查看消减步骤
  node dist/src/cli.js adjacency <id>              查看邻接表
  node dist/src/cli.js verify <id> a-b c-d ...     核验候选图
  node dist/src/cli.js export <id>                 导出 JSON`);
  }
}

main();
