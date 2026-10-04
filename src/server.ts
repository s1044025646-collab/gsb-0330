import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { GraphService } from "./service";
import { Store } from "./store";
import { ValidationError, LIMITS } from "./types";

const DATA_DIR = process.env.HH_DATA_DIR ? resolve(process.env.HH_DATA_DIR) : resolve(process.cwd(), "data");
const DB_PATH = resolve(DATA_DIR, "havel.db");

interface RouteContext {
  service: GraphService;
  params: Record<string, string>;
  body: unknown;
}

type Handler = (ctx: RouteContext) => unknown | null;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

function route(method: string, path: string, handler: Handler): Route {
  const paramNames: string[] = [];
  const patternText = path
    .replace(/:([A-Za-z]+)/g, (_, name) => {
      paramNames.push(name);
      return "([^/]+)";
    })
    .replace(/\//g, "\\/");
  return { method, pattern: new RegExp(`^${patternText}$`), paramNames, handler };
}

const routes: Route[] = [
  route("GET", "/health", () => ({ ok: true, limits: LIMITS })),
  route("POST", "/sequences", ({ service, body }) => service.createSequence((body as { vertices?: unknown })?.vertices ?? body)),
  route("GET", "/sequences/:id", ({ service, params }) => service.store.getSequence(Number(params.id))),
  route("POST", "/sequences/:id/construct", ({ service, params }) => service.build(Number(params.id))),
  route("GET", "/constructions/:id", ({ service, params }) => {
    const row = service.store.getConstruction(Number(params.id));
    return row ? { construction: row, report: row.report } : null;
  }),
  route("GET", "/constructions/:id/steps", ({ service, params }) => {
    const row = service.store.getConstruction(Number(params.id));
    return row ? { constructionId: row.id, status: row.status, rounds: row.rounds } : null;
  }),
  route("GET", "/constructions/:id/adjacency", ({ service, params }) => service.adjacency(Number(params.id))),
  route("POST", "/sequences/:id/verify", ({ service, params, body }) =>
    service.importCandidate(Number(params.id), (body as { edges?: unknown })?.edges ?? body)
  ),
  route("GET", "/sequences/:id/versions", ({ service, params }) => service.compareVersions(Number(params.id))),
  route("GET", "/constructions/:id/export", ({ service, params }) => service.exportConstruction(Number(params.id)))
];

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolvePromise({});
      try {
        resolvePromise(JSON.parse(text));
      } catch {
        rejectPromise(new ValidationError("INVALID_JSON", "请求体不是合法 JSON"));
      }
    });
    req.on("error", rejectPromise);
  });
}

function send(res: ServerResponse, status: number, payload: unknown) {
  const text = JSON.stringify(payload, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(text);
}

export function createApp(service: GraphService): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      let body: unknown = {};
      if (req.method === "POST") {
        body = await readBody(req);
      }
      for (const candidate of routes) {
        if (candidate.method !== req.method) continue;
        const match = candidate.pattern.exec(url.pathname);
        if (!match) continue;
        const params: Record<string, string> = {};
        candidate.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(match[i + 1]);
        });
        const result = await candidate.handler({ service, params, body });
        if (result === null) {
          return send(res, 404, { error: "NOT_FOUND", message: "资源不存在" });
        }
        return send(res, 200, result);
      }
      return send(res, 404, { error: "NOT_FOUND", message: `无此路由：${req.method} ${url.pathname}` });
    } catch (err) {
      if (err instanceof ValidationError) {
        return send(res, 400, { error: err.code, message: err.message, details: err.details ?? null });
      }
      const message = err instanceof Error ? err.message : String(err);
      return send(res, 500, { error: "INTERNAL_ERROR", message });
    }
  });
}

if (require.main === module) {
  const store = new Store(DB_PATH);
  const service = new GraphService(store);
  const server = createApp(service);
  const requestedPort = process.env.PORT ? Number(process.env.PORT) : 0;
  server.listen(requestedPort, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : requestedPort;
    console.log(`Havel–Hakimi 服务已启动: http://127.0.0.1:${port}`);
    console.log(`数据目录: ${DATA_DIR}`);
  });
}
