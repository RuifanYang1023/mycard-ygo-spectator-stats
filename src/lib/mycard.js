import fs from "node:fs";
import path from "node:path";
import { ACCOUNTS_BASE_URL, DEFAULT_LOCAL_STORAGE_DIR, SAPI_BASE_URL } from "./constants.js";

const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
let cachedAuth;
let cachedAuthAt = 0;

function decodeJwt(token) {
  try {
    const part = token.split(".")[1];
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

export function extractTokensFromLevelDb(dir = DEFAULT_LOCAL_STORAGE_DIR) {
  if (!fs.existsSync(dir)) return [];

  let raw = "";
  for (const entry of fs.readdirSync(dir)) {
    const file = path.join(dir, entry);
    if (!fs.statSync(file).isFile()) continue;
    if (!entry.endsWith(".ldb") && !entry.endsWith(".log")) continue;
    raw += fs.readFileSync(file, "latin1");
  }

  return [...new Set(raw.match(JWT_RE) ?? [])];
}

export function chooseLatestToken(tokens) {
  const now = Math.floor(Date.now() / 1000);
  const candidates = tokens
    .map((token) => ({ token, payload: decodeJwt(token) }))
    .filter(({ payload }) => !payload.exp || payload.exp > now)
    .sort((a, b) => (b.payload.iat ?? 0) - (a.payload.iat ?? 0));
  return candidates[0]?.token;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

export async function fetchAccount(token) {
  return fetchJson(`${ACCOUNTS_BASE_URL}/accounts/authUser`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

export async function resolveAuth({
  token,
  secret,
  username,
  storageDir = DEFAULT_LOCAL_STORAGE_DIR,
} = {}) {
  if (!token && !secret && cachedAuth && Date.now() - cachedAuthAt < 180000) {
    return cachedAuth;
  }

  if (token && secret) {
    return { token, secret: Number(secret), username: username ?? "spectator" };
  }

  if (!token) {
    token = chooseLatestToken(extractTokensFromLevelDb(storageDir));
  }
  if (!token) {
    throw new Error(
      "未找到 MyCard token。请用 --token 传入，或确认 MyCard 客户端已登录。",
    );
  }

  const account = await fetchAccount(token);
  const resolvedSecret = Number(secret ?? account.u16Secret);
  if (!Number.isInteger(resolvedSecret) || resolvedSecret <= 0) {
    throw new Error("authUser 没有返回有效的 u16Secret");
  }

  const result = {
    token,
    secret: resolvedSecret,
    username: username ?? account.username ?? "spectator",
    account,
  };
  if (!secret) {
    cachedAuth = result;
    cachedAuthAt = Date.now();
  }
  return result;
}

export async function fetchDeckAnalytics({
  type = "week",
  source = "mycard-athletic",
} = {}) {
  const url = new URL(`${SAPI_BASE_URL}/ygopro/analytics/deck/type`);
  url.searchParams.set("type", type);
  url.searchParams.set("source", source);
  return fetchJson(url);
}

export async function fetchArenaHistory(username) {
  const url = new URL(`${SAPI_BASE_URL}/ygopro/arena/history`);
  url.searchParams.set("username", username);
  return fetchJson(url);
}
