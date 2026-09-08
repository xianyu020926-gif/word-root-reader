import { spawn } from "node:child_process";
import path from "node:path";

const mode = process.argv[2] || "dev";
const executable = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "vinext.cmd" : "vinext");
const child = spawn(executable, [mode], {
  stdio: "inherit",
  env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/wrangler.log" },
  shell: process.platform === "win32",
});
child.on("exit", code => process.exit(code ?? 1));
