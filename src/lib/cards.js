import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

let cardNameMapPromise;

function resolveCardDbPath() {
  return process.env.YGO_CARD_DB ?? path.resolve(process.cwd(), "cards.cdb");
}

async function loadCardNameMap() {
  const dbPath = resolveCardDbPath();
  if (!fs.existsSync(dbPath)) {
    return new Map();
  }

  const SQL = await initSqlJs({
    locateFile: (file) => path.resolve(process.cwd(), "node_modules", "sql.js", "dist", file),
  });
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const result = db.exec("select id, name from texts");
  db.close();

  const map = new Map();
  for (const row of result[0]?.values ?? []) {
    const id = Number(row[0]);
    const name = String(row[1] ?? "").trim();
    if (id && name) map.set(id, name);
  }
  return map;
}

export function getCardNameMap() {
  cardNameMapPromise ??= loadCardNameMap();
  return cardNameMapPromise;
}

export async function resolveCardNames(codes) {
  const map = await getCardNameMap();
  const unique = [...new Set(codes.map(Number).filter((code) => Number.isInteger(code) && code > 0))];
  const named = new Map();
  for (const code of unique) {
    named.set(code, map.get(code) ?? `卡号 ${code}`);
  }
  return named;
}

export async function getCardName(code) {
  return (await resolveCardNames([code])).get(Number(code)) ?? `卡号 ${code}`;
}
