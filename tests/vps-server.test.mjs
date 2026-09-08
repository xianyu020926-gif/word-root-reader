import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

test("VPS runtime serves the PWA and exposes only managed-key status", { timeout: 15000 }, async () => {
  const child = spawn(process.execPath, ["server/vps-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, HOST: "127.0.0.1", PORT: "0", DEEPSEEK_API_KEY: "managed-test-key" },
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
    assert.deepEqual(health, { ok: true, version: "0.15.0", managedKey: true });

    const config = await fetch(`http://127.0.0.1:${port}/api/deepseek`).then(response => response.json());
    assert.deepEqual(config, { managedKey: true, managedModel: false });
    assert.equal(JSON.stringify(config).includes("managed-test-key"), false);
  } finally {
    child.kill("SIGTERM");
  }
});
