# Havel–Hakimi 度序列构图后端

纯本地 Windows 可运行的度序列实现服务：TypeScript + Node.js + SQLite（`node:sqlite` 内置模块，无原生依赖、无 Docker、无外部服务）。只提供 HTTP API 与 CLI，不含前端。

## 功能

- 输入带稳定编号的顶点及目标度，判断是否存在无自环、无重边的简单无向图
- 自行实现 Havel–Hakimi 消减：每轮按剩余度降序、平局按编号升序，记录排序、选中邻居与消减前后值
- 开始前校验：非负整数度、度 < 顶点数、总度数为偶数（仅为必要条件，不据此直接判可实现）
- 不可实现时返回失败轮次与证据，绝不返回缺边图冒充成功；成功/失败在库中分开标识
- 独立候选图核验：检查陌生顶点、自环、无向重复边（端点交换不重复计数）、逐顶点目标/实际度
- SQLite 持久化原始输入、平局规则、算法版本、边与报告；重启后可查询同一序列；输入修改即新建版本
- 限制：顶点数 ≤ 200，边数 ≤ 5000，步骤明细 ≤ 1000 轮，超限在构造前拒绝

## 构建 / 测试 / 启动 / 演示

```powershell
npm install
npm run build     # 编译到 dist/
npm test          # 构建并运行全部测试（含 n<=5 穷举全部简单图比对）
npm start         # 启动 API（PORT 环境变量可指定端口，默认 8787 被占用时自动选空闲端口）
npm run demo      # CLI 演示 2,2,1,1（可实现）与 3,3,1,1（不可实现）
```

数据目录为项目内 `data/`（可用 `HH_DATA_DIR`、`HH_DB_PATH` 覆盖）。

## CLI

```
node dist/src/cli.js construct a:2 b:2 c:1 d:1   构造并打印消减表与邻接表
node dist/src/cli.js demo                        两个演示
node dist/src/cli.js list                        列出全部序列版本
node dist/src/cli.js steps <id>                  查看消减步骤
node dist/src/cli.js adjacency <id>              查看邻接表
node dist/src/cli.js verify <id> a-b a-c b-d     核验候选图
node dist/src/cli.js export <id>                 导出 JSON
```

## HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/sequences` | 创建并构造，body: `{"vertices":[{"id":"a","degree":2},...]}` |
| GET | `/sequences` | 列出全部版本 |
| GET | `/sequences/:id` | 读取详情（含状态、原因、边） |
| GET | `/sequences/:id/steps` | 消减步骤 |
| GET | `/sequences/:id/adjacency` | 邻接表 |
| POST | `/sequences/:id/verify` | 核验候选图，body: `{"edges":[["a","b"],...]}` |
| POST | `/verify` | 独立核验，body 同时带 `vertices` 与 `edges` |
| GET | `/sequences/:id/export` | 导出完整 JSON |
| GET | `/compare?a=1&b=2` | 比较两个版本 |

## 错误码

`INVALID_FORMAT`、`INVALID_JSON`、`DUPLICATE_ID`、`INVALID_DEGREE`、`DEGREE_OUT_OF_RANGE`、`ODD_TOTAL_DEGREE`、`LIMIT_EXCEEDED`、`NOT_FOUND`、`INTERNAL`。格式错误（如非整数度）与"合法但不可实现"（`status: unrealizable`）严格区分。

## 说明与限制

- 构造结果是某一张可行图，不代表全部实现，也不做同构分类、唯一性或布局
- 平局规则固定为"剩余度降序、编号升序"，输入行排列不影响结果（有测试保证）
- 算法版本 `havel-hakimi-v1` 与平局规则随每条记录入库，旧版本记录不会被重新解释
