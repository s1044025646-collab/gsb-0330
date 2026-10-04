import http from "node:http";
import net from "node:net";
import { construct, exportSequence, getAdjacency, getSequenceDetail, ServiceError, verify, compareVersions } from "./service";
import { listSequences } from "./db";

function send(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new ServiceError("INVALID_JSON", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function route(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const m = url.pathname.match(/^\/sequences\/(\d+)(\/steps|\/adjacency|\/export|\/verify)?$/);
  if (req.method === "POST" && url.pathname === "/sequences") {
    const body = (await readBody(req)) as { vertices?: unknown };
    return send(res, 201, construct(body.vertices));
  }
  if (req.method === "GET" && url.pathname === "/sequences") {
    return send(res, 200, listSequences());
  }
  if (m) {
    const id = Number(m[1]);
    const sub = m[2];
    if (req.method === "GET" && !sub) return send(res, 200, getSequenceDetail(id));
    if (req.method === "GET" && sub === "/steps") return send(res, 200, getSequenceDetail(id).steps);
    if (req.method === "GET" && sub === "/adjacency") return send(res, 200, getAdjacency(id));
    if (req.method === "GET" && sub === "/export") return send(res, 200, exportSequence(id));
    if (req.method === "POST" && sub === "/verify") {
      const body = (await readBody(req)) as { edges?: unknown };
      return send(res, 200, verify(id, null, body.edges));
    }
  }
  if (req.method === "POST" && url.pathname === "/verify") {
    const body = (await readBody(req)) as { vertices?: unknown; edges?: unknown };
    return send(res, 200, verify(null, body.vertices, body.edges));
  }
  if (req.method === "GET" && url.pathname === "/compare") {
    const a = Number(url.searchParams.get("a"));
    const b = Number(url.searchParams.get("b"));
    return send(res, 200, compareVersions(a, b));
  }
  return send(res, 404, { error: { code: "NOT_FOUND", message: "路由不存在" } });
}

function findFreePort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(findFreePort(0)));
    srv.listen(preferred, () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
  });
}

export async function startServer(port?: number) {
  const p = port ?? (await findFreePort(Number(process.env.PORT ?? 8787)));
  const server = http.createServer((req, res) => {
    route(req, res, new URL(req.url ?? "/", "http://localhost")).catch((e) => {
      if (e instanceof ServiceError) {
        send(res, 400, { error: { code: e.code, message: e.message, details: e.details } });
      } else {
        send(res, 500, { error: { code: "INTERNAL", message: String(e) } });
      }
    });
  });
  await new Promise<void>((r) => server.listen(p, r));
  console.log(`HH server listening on http://localhost:${p}`);
  return server;
}

if (require.main === module) {
  startServer(process.env.PORT ? Number(process.env.PORT) : undefined);
}
