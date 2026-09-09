import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("VPS runtime isolates accounts, syncs a private archive and protects AI", { timeout: 20000 }, async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "word-reader-vps-"));
  const child = spawn(process.execPath, ["server/vps-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "0",
      DEEPSEEK_API_KEY: "managed-test-key",
      APP_DATA_FILE: path.join(dataDir, "store.json"),
      APP_SESSION_SECRET: "test-session-secret-that-is-longer-than-32-characters",
      APP_INVITE_CODE: "invite-test-code",
      INITIAL_OWNER_USERNAME: "owner",
      INITIAL_OWNER_PASSWORD: "owner-test-password",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { stderr += chunk; });

  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`VPS runtime did not start: ${stderr}`)), 10000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", chunk => {
        const match = chunk.match(/:(\d+)/);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`VPS runtime exited ${code}: ${stderr}`)); });
    });

    const root = await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual" });
    assert.equal(root.status, 302);
    assert.equal(root.headers.get("location"), "/mobile.html");

    const page = await fetch(`http://127.0.0.1:${port}/mobile.html`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /单点穿透/);

    const health = await fetch(`http://127.0.0.1:${port}/healthz`).then(response => response.json());
    assert.deepEqual(health, { ok: true, version: "0.16.0", managedKey: true });

    const blocked = await fetch(`http://127.0.0.1:${port}/api/deepseek`);
    assert.equal(blocked.status, 401);

    const origin = `http://127.0.0.1:${port}`;
    const login = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ username: "owner", password: "owner-test-password" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";", 1)[0];

    const config = await fetch(`${origin}/api/deepseek`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.deepEqual(config, { managedKey: true, managedModel: false });
    assert.equal(JSON.stringify(config).includes("managed-test-key"), false);

    const snapshot = { format: "single-point-learning", version: 1, wordbook: {}, articles: {}, current: null };
    const save = await fetch(`${origin}/api/sync`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie },
      body: JSON.stringify({ snapshot }),
    });
    assert.equal(save.status, 200);
    const restored = await fetch(`${origin}/api/sync`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.deepEqual(restored.snapshot, snapshot);

    const registration = await fetch(`${origin}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ username: "friend", password: "friend-password", inviteCode: "invite-test-code" }),
    });
    assert.equal(registration.status, 200);
    const friendCookie = registration.headers.get("set-cookie").split(";", 1)[0];
    const friendArchive = await fetch(`${origin}/api/sync`, { headers: { Cookie: friendCookie } }).then(response => response.json());
    assert.equal(friendArchive.snapshot, null);
  } finally {
    child.kill("SIGTERM");
    await rm(dataDir, { recursive: true, force: true });
  }
});
