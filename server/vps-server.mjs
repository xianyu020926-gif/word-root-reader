import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile, stat } from "node:fs/promises";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicRoot = path.join(projectRoot, "public");
const workerPath = path.join(projectRoot, "dist", "server", "index.js");
const { default: worker } = await import(pathToFileURL(workerPath).href);

const port = Number.parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "0.0.0.0";
const maxBodyBytes = 2 * 1024 * 1024;

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
  [".txt", "text/plain; charset=utf-8"],
]);

function applySecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function sendJson(response, status, value) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  applySecurityHeaders(response);
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("请求内容过大。");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function proxyApi(request, response, requestUrl) {
  const body = await readBody(request);
  const headers = new Headers();
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    headers.append(request.rawHeaders[index], request.rawHeaders[index + 1]);
  }
  const init = { method: request.method, headers };
  if (body && !["GET", "HEAD"].includes(request.method || "GET")) init.body = body;

  const webResponse = await worker.fetch(new Request(requestUrl, init), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });

  response.statusCode = webResponse.status;
  webResponse.headers.forEach((value, name) => response.setHeader(name, value));
  applySecurityHeaders(response);
  if (request.method === "HEAD") return response.end();
  response.end(Buffer.from(await webResponse.arrayBuffer()));
}

async function serveStatic(request, response, pathname) {
  if (pathname === "/" || pathname === "/mobile") {
    response.statusCode = 302;
    response.setHeader("Location", "/mobile.html");
    response.setHeader("Cache-Control", "no-store");
    applySecurityHeaders(response);
    return response.end();
  }

  let decodedPath;
  try { decodedPath = decodeURIComponent(pathname); }
  catch { return sendJson(response, 400, { error: "地址格式不正确。" }); }

  const relativePath = decodedPath.replace(/^\/+/, "");
  const filePath = path.resolve(publicRoot, relativePath);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) {
    return sendJson(response, 403, { error: "禁止访问。" });
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("not a file");
    const data = await readFile(filePath);
    response.statusCode = 200;
    response.setHeader("Content-Type", mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream");
    response.setHeader("Content-Length", data.length);
    response.setHeader("Cache-Control", relativePath === "sw.js" || relativePath.endsWith(".html") ? "no-cache" : "public, max-age=3600");
    applySecurityHeaders(response);
    if (request.method === "HEAD") return response.end();
    response.end(data);
  } catch {
    sendJson(response, 404, { error: "页面不存在。" });
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const forwardedProto = String(request.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
    const requestUrl = new URL(request.url || "/", `${forwardedProto}://${request.headers.host || "localhost"}`);
    if (requestUrl.pathname === "/healthz") {
      return sendJson(response, 200, {
        ok: true,
        version: "0.15.0",
        managedKey: String(process.env.DEEPSEEK_API_KEY || "").trim().length >= 8,
      });
    }
    if (requestUrl.pathname.startsWith("/api/")) return await proxyApi(request, response, requestUrl);
    if (!["GET", "HEAD"].includes(request.method || "GET")) return sendJson(response, 405, { error: "请求方法不支持。" });
    return await serveStatic(request, response, requestUrl.pathname);
  } catch (error) {
    sendJson(response, Number(error?.statusCode) || 500, { error: Number(error?.statusCode) ? error.message : "服务器暂时无法处理请求。" });
  }
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.log(`word-root-reader listening on http://${host}:${actualPort}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
