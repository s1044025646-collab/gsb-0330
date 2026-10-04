# Havel–Hakimi 度序列构图与失败解释后端

有限**无向简单图**度序列可实现性判定与构图服务。输入带稳定编号的顶点及其目标度数：

- 判断是否存在**无自环、无重边**的图使每个顶点恰好达到目标度数；
- 存在时给出一张具体图（不要求连通、不唯一、不做布局）；
- 不可实现时保留原序列与消减到失败的全过程，给出本轮证据，**绝不返回缺边图充当成功**；
- 另有独立的候选图核验接口，对任意外部边列表逐边复算，不信任生成器附带的度数统计。

只做后端：TypeScript + Node.js + 内置 SQLite（`node:sqlite`，无需本地编译、无外部服务）。

## 环境要求

- Windows 本地运行；Node.js **>= 22.5**（开发与验证使用 Node v25.5.0）。
- 不依赖 Docker、WSL、付费服务或在线 API。

## 快速开始

```powershell
npm install
npm run build
npm test          # 构建并运行全部测试（含 n≤5 全部简单图穷举交叉验证）
npm run demo      # CLI 演示：2,2,1,1 成功 与 3,3,1,1 失败 全过程
npm start         # 启动 HTTP API；默认端口 0 = 系统分配空闲端口，启动时打印实际地址
```

可配置项（环境变量）：

- `PORT`：HTTP 端口，默认 `0`（空闲端口）。例如 `$env:PORT=8080; npm start`。
- `HH_DATA_DIR`：SQLite 数据目录，默认项目内 `./data`，数据库文件 `data/havel.db`。

## 算法与编号规则

自行实现 Havel–Hakimi 消减（`src/havel.ts`），每轮：

1. 按**剩余度数降序**排列未处理顶点；平局时按**固定顶点编号升序**
   （纯数字编号按数值比较，否则按字典序）。该顺序只由编号与度数决定，
   改变输入行的排列但保留“编号↔度数”不会改变构造结果。
2. 取最大剩余度为 `d` 的顶点，与接下来剩余度为正的前 `d` 个顶点连接，
   将它们的剩余度各减 1、pivot 置 0。
3. 记录本轮排序结果、pivot、选中邻居、新增边、消减前后剩余度。
   所有记录一律使用**原顶点编号**，不使用每轮重排后的数组下标充当身份。
4. 全部剩余度为 0 即成功；正度邻居数量不足（会导致负剩余度）即失败。

### 前置校验（区分两类错误）

- **格式错误（HTTP 400，抛 `ValidationError`）**：顶点不是数组、`id` 非空字符串、
  编号重复（`DUPLICATE_ID`）、度数非整数（`INVALID_DEGREE`）、负度数（`NEGATIVE_DEGREE`）、
  JSON 非法（`INVALID_JSON`）、超过顶点/轮次/边数上限。
  空顶点集与全零序列是**合法输入**。
- **合法输入但不可实现（HTTP 200，报告 `status:"failure"`）**：
  - `DEGREE_EXCEEDS_MAX`：某度数 ≥ 顶点数；
  - `SUM_ODD`：总度数为奇数（握手引理；仅是必要条件，不会因偶数就直接判成功）；
  - `INSUFFICIENT_NEIGHBORS` / `NEGATIVE_RESIDUAL`：消减到某轮无法在简单图内完成。

### 限制（构造前整体拒绝，不截断）

| 限制 | 默认值 |
| --- | --- |
| 最大顶点数 `MAX_VERTICES` | 500 |
| 最大边数 `MAX_EDGES` | 10000 |
| 最大消减轮数 `MAX_STEPS` | 5000 |
| 最大候选边数 `MAX_CANDIDATE_EDGES` | 10000 |

超限在构造前以错误码拒绝，不会只截断边列表或步骤明细后返回。

## 候选图独立核验

`POST /sequences/:id/verify` 接受原顶点集对应的任意外部边列表，逐项检查：

- `UNKNOWN_VERTEX`：边引用了顶点集中不存在的编号；
- `SELF_LOOP`：自环（`u == v`）；
- `DUPLICATE_EDGE`：无向重复边（`{u,v}` 与 `{v,u}` 视为同一条，不构成第二条）；
- `DEGREE_MISMATCH`：从去重后的合法边**逐边复算**的实际度数与目标度数不符。

返回每个顶点的目标/实际度数、边数与问题清单。只说明“这一张图是否与度序列一致”，
不代表它是唯一实现，也不代表全部可能实现。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查与当前限制 |
| POST | `/sequences` | 创建度序列（body：`{"vertices":[{"id":"1","degree":2},...]}`） |
| GET | `/sequences/:id` | 读取序列（原始输入、编号顺序规则、算法版本） |
| POST | `/sequences/:id/construct` | 执行 Havel–Hakimi 构造，生成新版本与报告 |
| GET | `/constructions/:id` | 读取构造与成功/失败报告 |
| GET | `/constructions/:id/steps` | 读取消减步骤明细 |
| GET | `/constructions/:id/adjacency` | 查询邻接表（含零度孤立顶点） |
| POST | `/sequences/:id/verify` | 导入并独立核验候选边列表 |
| GET | `/sequences/:id/versions` | 比较该序列的各构造版本 |
| GET | `/constructions/:id/export` | 导出完整序列+构造+报告 JSON |

示例（PowerShell）：

```powershell
# 1) 创建
Invoke-RestMethod -Method Post http://127.0.0.1:8080/sequences -ContentType 'application/json' `
  -InFile examples/vertices-2211.json
# 2) 构造（用返回的 id）
Invoke-RestMethod -Method Post http://127.0.0.1:8080/sequences/1/construct -Body '{}'
# 3) 核验候选图
Invoke-RestMethod -Method Post http://127.0.0.1:8080/sequences/1/verify -ContentType 'application/json' `
  -InFile examples/candidate-good.json
```

## CLI

```powershell
node dist/src/cli.js demo
node dist/src/cli.js serve [--port 8080]
node dist/src/cli.js create 1=2 2=2 3=1 4=1
node dist/src/cli.js create examples/vertices-2211.json
node dist/src/cli.js construct <sequenceId>
node dist/src/cli.js steps <constructionId>        # 中文消减表
node dist/src/cli.js adjacency <constructionId>    # 邻接表 JSON
node dist/src/cli.js verify <sequenceId> examples/candidate-bad.json
node dist/src/cli.js versions <sequenceId>
node dist/src/cli.js export <constructionId>
```

## 持久化与版本语义

SQLite 三张表：`sequences`（原始输入、输入编号顺序、平局规则、算法版本）、
`constructions`（`status` 为 `success`/`failure` 分开标识，边、消减轮次、报告、算法版本）、
`candidates`（来源 `generated`/`imported`、是否通过、核验结果）。

- 重启后可用同一 ID 查询同一张图与报告（测试覆盖）。
- 输入修改会新建序列；对同一序列再次构造会生成递增新版本。
- 旧构造按其当时的输入与算法版本冻结，不会被修改后的目标度数重新解释。

## 测试

`npm test` 共 24 个用例，覆盖：

- 空顶点集、单个零度顶点、全零、完全图度数 `n-1`；
- 编号重复、负度数/非整数、奇数总度数、度数达到顶点数；
- 可实现 `2,2,1,1` 与“范围合法且总和偶数但不可实现”的 `3,3,1,1`；
- 输入行重排确定性、失败保留过程且不产边；
- 候选核验：自环、无向重复边（含端点交换）、陌生顶点、度数不符；
- **对 0–5 个顶点独立枚举全部 `2^(n(n-1)/2)` 张简单图**，
  收集实际出现的度序列集合，与构造器的可实现判定逐一比对，并对成功结果逐边复算；
- SQLite 重启后报告读取、版本冻结、成功/失败分状态；
- HTTP 全流程与 400 错误码。

## 代码结构

- `src/types.ts`：类型、错误码、算法版本、限制常量；
- `src/havel.ts`：输入格式校验、编号平局比较、Havel–Hakimi 消减、边规范化；
- `src/verify.ts`：候选图独立核验与邻接表构建；
- `src/store.ts`：SQLite schema 与持久化；
- `src/service.ts`：构造/核验/报告/版本/导出编排；
- `src/server.ts`：HTTP API 路由与错误码映射；
- `src/cli.ts`：中文 CLI、消减表/邻接表展示与内置演示；
- `test/`：核心、穷举枚举、持久化与 HTTP 集成测试。

## 已知限制与假设

- 未明确编号形式时，假设 `id` 为非空字符串；纯数字串平局时按数值排序，其余按字典序。
- 图不要求连通；服务返回 Havel–Hakimi 确定产生的一张图，不枚举或分类全部实现。
- `node:sqlite` 在当前 Node 版本带实验性警告，启动命令已统一加 `--no-warnings`；
  API 稳定后如 Node 调整该内置模块，仅需小幅修改 `src/store.ts`。
