import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const USERNAME_PATTERN = /^[A-Za-z0-9_\-\u4e00-\u9fff]{2,24}$/u;
const PASSWORD_MIN = 8;
const SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024;

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function passwordRecord(password, salt = randomBytes(16).toString("base64url")) {
  return {
    salt,
    hash: scryptSync(password, salt, 64).toString("base64url"),
  };
}

export function validateUsername(value) {
  const username = String(value || "").trim();
  if (!USERNAME_PATTERN.test(username) || ["__proto__", "constructor", "prototype"].includes(username.toLowerCase())) {
    throw Object.assign(new Error("用户名只能使用 2–24 位中文、英文、数字、下划线或短横线。"), { statusCode: 400 });
  }
  return username;
}

export function validatePassword(value) {
  const password = String(value || "");
  if (password.length < PASSWORD_MIN || password.length > 128) {
    throw Object.assign(new Error("密码需要 8–128 个字符。"), { statusCode: 400 });
  }
  return password;
}

export class AccountStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { version: 1, users: Object.create(null) };
    this.ready = this.#load();
    this.writeQueue = Promise.resolve();
  }

  async #load() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      if (parsed?.version !== 1 || !parsed.users || typeof parsed.users !== "object") throw new Error("invalid store");
      this.data = parsed;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(path.dirname(this.filePath), { recursive: true });
    }
  }

  async #persist() {
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(temporary, JSON.stringify(this.data), { mode: 0o600 });
    await rename(temporary, this.filePath);
  }

  async mutate(action) {
    await this.ready;
    let result;
    const operation = this.writeQueue.catch(() => {}).then(async () => {
      result = await action();
      await this.#persist();
    });
    this.writeQueue = operation.catch(() => {});
    await operation;
    return result;
  }

  async seedOwner(username, password) {
    if (!username || !password) return;
    await this.ready;
    const normalized = validateUsername(username).toLowerCase();
    if (this.data.users[normalized]) return;
    await this.mutate(async () => {
      if (this.data.users[normalized]) return;
      const credentials = passwordRecord(validatePassword(password));
      this.data.users[normalized] = {
        username: username.trim(),
        role: "owner",
        ...credentials,
        createdAt: new Date().toISOString(),
        snapshot: null,
        snapshotUpdatedAt: null,
      };
    });
  }

  async register(username, password) {
    await this.ready;
    const displayName = validateUsername(username);
    const normalized = displayName.toLowerCase();
    const validPassword = validatePassword(password);
    return this.mutate(async () => {
      if (this.data.users[normalized]) throw Object.assign(new Error("这个用户名已经有人使用。"), { statusCode: 409 });
      const credentials = passwordRecord(validPassword);
      this.data.users[normalized] = {
        username: displayName,
        role: "learner",
        ...credentials,
        createdAt: new Date().toISOString(),
        snapshot: null,
        snapshotUpdatedAt: null,
      };
      return { username: displayName, role: "learner" };
    });
  }

  async verify(username, password) {
    await this.ready;
    const normalized = String(username || "").trim().toLowerCase();
    const user = this.data.users[normalized];
    if (!user || typeof password !== "string") return null;
    const attempted = passwordRecord(password, user.salt).hash;
    if (!safeEqual(attempted, user.hash)) return null;
    return { username: user.username, role: user.role || "learner" };
  }

  async getUser(username) {
    await this.ready;
    const user = this.data.users[String(username || "").toLowerCase()];
    return user ? { username: user.username, role: user.role || "learner" } : null;
  }

  async getSnapshot(username) {
    await this.ready;
    await this.writeQueue;
    const user = this.data.users[String(username || "").toLowerCase()];
    if (!user) return null;
    return { snapshot: user.snapshot || null, updatedAt: user.snapshotUpdatedAt || null };
  }

  async saveSnapshot(username, snapshot) {
    const serialized = JSON.stringify(snapshot);
    if (Buffer.byteLength(serialized) > SNAPSHOT_MAX_BYTES) {
      throw Object.assign(new Error("云档案超过 5 MB，请先删除不再需要的文章。"), { statusCode: 413 });
    }
    if (snapshot?.format !== "single-point-learning" || snapshot?.version !== 1) {
      throw Object.assign(new Error("云档案格式不正确。"), { statusCode: 400 });
    }
    return this.mutate(async () => {
      const user = this.data.users[String(username || "").toLowerCase()];
      if (!user) throw Object.assign(new Error("账户不存在。"), { statusCode: 404 });
      user.snapshot = snapshot;
      user.snapshotUpdatedAt = new Date().toISOString();
      return { updatedAt: user.snapshotUpdatedAt };
    });
  }
}

export function createSessionCodec(secret) {
  if (String(secret || "").length < 32) throw new Error("APP_SESSION_SECRET 至少需要 32 个字符");
  const sign = value => createHmac("sha256", secret).update(value).digest("base64url");
  return {
    issue(user, now = Date.now()) {
      const body = Buffer.from(JSON.stringify({ username: user.username, role: user.role, expiresAt: now + 30 * 86400000 })).toString("base64url");
      return `${body}.${sign(body)}`;
    },
    verify(token, now = Date.now()) {
      try {
        const [body, signature, extra] = String(token || "").split(".");
        if (!body || !signature || extra || !safeEqual(signature, sign(body))) return null;
        const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        if (!payload.username || !payload.expiresAt || payload.expiresAt <= now) return null;
        return payload;
      } catch {
        return null;
      }
    },
  };
}

export class WindowRateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.entries = new Map();
  }

  consume(key, now = Date.now()) {
    const normalized = String(key || "unknown");
    let entry = this.entries.get(normalized);
    if (!entry || entry.resetAt <= now) entry = { count: 0, resetAt: now + this.windowMs };
    entry.count += 1;
    this.entries.set(normalized, entry);
    return { allowed: entry.count <= this.limit, remaining: Math.max(0, this.limit - entry.count), resetAt: entry.resetAt };
  }
}

export function inviteMatches(provided, expected) {
  return Boolean(expected) && safeEqual(String(provided || ""), String(expected));
}
