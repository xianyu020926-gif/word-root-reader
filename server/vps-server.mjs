import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile, stat } from "node:fs/promises";
import { AccountStore, WindowRateLimiter, createSessionCodec, inviteMatches } from "./multiuser.mjs";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicRoot = path.join(projectRoot, "public");
const workerPath = path.join(projectRoot, "dist", "server", "index.js");
const { default: worker } = await import(pathToFileURL(workerPath).href);

const port = Number.parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "0.0.0.0";
const maxBodyBytes = 6 * 1024 * 1024;
const sessionCookie = "word_reader_session";
const accountStore = new AccountStore(process.env.APP_DATA_FILE || "/data/app-store.json");
const sessionCodec = createSessionCodec(process.env.APP_SESSION_SECRET || "development-only-session-secret-change-me");
const loginLimiter = new WindowRateLimiter(12, 15 * 60 * 1000);
const aiLimiter = new WindowRateLimiter(60, 10 * 60 * 1000);
const dailyAiLimiter = new WindowRateLimiter(300, 24 * 60 * 60 * 1000);
const syncLimiter = new WindowRateLimiter(120, 60 * 60 * 1000);

await accountStore.seedOwner(process.env.INITIAL_OWNER_USERNAME || "", process.env.INITIAL_OWNER_PASSWORD || "");

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

function clientIp(request) {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function cookies(request) {
  const result = Object.create(null);
  for (const item of String(request.headers.cookie || "").split(";")) {
    const separator = item.indexOf("=");
    if (separator < 1) continue;
    result[item.slice(0, separator).trim()] = decodeURIComponent(item.slice(separator + 1).trim());
  }
  return result;
}

function expectedOrigin(request) {
  const protocol = String(request.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  return `${protocol}://${request.headers.host}`;
}

function requireSameOrigin(request) {
  const origin = String(request.headers.origin || "");
  if (!origin || origin !== expectedOrigin(request)) {
    throw Object.assign(new Error("请求来源无法确认，请刷新页面后重试。"), { statusCode: 403 });
  }
}

function setSessionCookie(response, token) {
  response.setHeader("Set-Cookie", `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`);
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", `${sessionCookie}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

function enforceLimit(response, result) {
  response.setHeader("X-RateLimit-Remaining", result.remaining);
  if (result.allowed) return;
  response.setHeader("Retry-After", Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)));
  throw Object.assign(new Error("操作太频繁，请稍后再试。"), { statusCode: 429 });
}

async function readJson(request) {
  const body = await readBody(request);
  try { return body ? JSON.parse(body.toString("utf8")) : {}; }
  catch { throw Object.assign(new Error("请求内容不是有效数据。"), { statusCode: 400 }); }
}

async function authenticatedUser(request) {
  const payload = sessionCodec.verify(cookies(request)[sessionCookie]);
  if (!payload) return null;
  return accountStore.getUser(payload.username);
}

async function requireUser(request) {
  const user = await authenticatedUser(request);
  if (!user) throw Object.assign(new Error("请先登录学习账户。"), { statusCode: 401 });
  return user;
}

async function handleAuth(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/auth/status") {
    const user = await authenticatedUser(request);
    return sendJson(response, 200, { authenticated: Boolean(user), user });
  }
  if (request.method !== "POST") return sendJson(response, 405, { error: "请求方法不支持。" });
  requireSameOrigin(request);
  enforceLimit(response, loginLimiter.consume(clientIp(request)));

  if (pathname === "/api/auth/logout") {
    clearSessionCookie(response);
    return sendJson(response, 200, { ok: true });
  }

  const payload = await readJson(request);
  let user;
  if (pathname === "/api/auth/register") {
    if (!inviteMatches(payload.inviteCode, process.env.APP_INVITE_CODE)) {
      return sendJson(response, 403, { error: "邀请码不正确。" });
    }
    user = await accountStore.register(payload.username, payload.password);
  } else if (pathname === "/api/auth/login") {
    user = await accountStore.verify(payload.username, payload.password);
    if (!user) return sendJson(response, 401, { error: "用户名或密码不正确。" });
  } else {
    return sendJson(response, 404, { error: "接口不存在。" });
  }

  setSessionCookie(response, sessionCodec.issue(user));
  return sendJson(response, 200, { ok: true, user });
}

async function handleSync(request, response) {
  const user = await requireUser(request);
  enforceLimit(response, syncLimiter.consume(user.username.toLowerCase()));
  if (request.method === "GET") return sendJson(response, 200, await accountStore.getSnapshot(user.username));
  if (request.method === "PUT") {
    requireSameOrigin(request);
    const payload = await readJson(request);
    return sendJson(response, 200, await accountStore.saveSnapshot(user.username, payload.snapshot));
  }
  return sendJson(response, 405, { error: "请求方法不支持。" });
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
        version: "0.16.0",
        managedKey: String(process.env.DEEPSEEK_API_KEY || "").trim().length >= 8,
      });
    }
    if (requestUrl.pathname.startsWith("/api/auth/")) return await handleAuth(request, response, requestUrl.pathname);
    if (requestUrl.pathname === "/api/sync") return await handleSync(request, response);
    if (requestUrl.pathname.startsWith("/api/")) {
      const user = await requireUser(request);
      if (request.method === "POST") {
        requireSameOrigin(request);
        enforceLimit(response, aiLimiter.consume(user.username.toLowerCase()));
        enforceLimit(response, dailyAiLimiter.consume(user.username.toLowerCase()));
      }
      return await proxyApi(request, response, requestUrl);
    }
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
