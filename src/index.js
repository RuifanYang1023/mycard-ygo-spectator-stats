import path from "node:path";
import { getCardName, resolveCardNames } from "./lib/cards.js";
import { DEFAULT_GAME_HOST, DEFAULT_GAME_PORT, PROTOCOL_VERSION } from "./lib/constants.js";
import { DuelCollector } from "./lib/duel-collector.js";
import { computeCardStats, formatPercent } from "./lib/stats.js";
import { makeJoinPassword } from "./lib/protocol.js";
import { fetchDeckAnalytics, resolveAuth } from "./lib/mycard.js";
import { fetchStartedRooms } from "./lib/room-list.js";
import { SpectatorSession } from "./lib/spectator.js";
import { appendRecord, loadRecords, writeJson } from "./lib/storage.js";

function parseArgs(argv) {
  const result = { _: [], flags: {}, options: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        result.options[key] = next;
        i += 1;
      } else {
        result.flags[key] = true;
      }
    } else {
      result._.push(arg);
    }
  }
  return result;
}

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function printTable(rows) {
  if (!rows.length) {
    console.log("(空)");
    return;
  }
  const keys = Object.keys(rows[0]);
  const widths = new Map();
  for (const key of keys) {
    widths.set(
      key,
      Math.max(key.length, ...rows.map((row) => String(row[key] ?? "").length)),
    );
  }
  console.log(
    keys.map((key) => key.padEnd(widths.get(key))).join("  "),
  );
  for (const row of rows) {
    console.log(
      keys.map((key) => String(row[key] ?? "").padEnd(widths.get(key))).join("  "),
    );
  }
}

async function runRooms(args) {
  const rooms = await fetchStartedRooms();
  if (args.flags.json) {
    console.log(JSON.stringify(rooms, null, 2));
    return;
  }
  const rows = rooms.map((room) => ({
    id: room.id,
    arena: room.arena ?? "-",
    first: room.users?.find((user) => user.position === 0)?.username ?? "-",
    second: room.users?.find((user) => user.position === 1)?.username ?? "-",
    mode: room.options?.mode ?? "-",
    noWatch: room.options?.no_watch ?? false,
  }));
  printTable(rows);
}

async function runAuth(args) {
  const auth = await resolveAuth({
    token: args.options.token,
    secret: args.options.secret,
    username: args.options.username,
    storageDir: args.options.storage,
  });
  if (args.flags.json) {
    console.log(JSON.stringify({ username: auth.username, secret: auth.secret }, null, 2));
    return;
  }
  console.log(`username: ${auth.username}`);
  console.log(`u16Secret: ${auth.secret}`);
}

async function runAnalytics(args) {
  const type = args.options.type ?? "week";
  const source = args.options.source ?? "mycard-athletic";
  const limit = num(args.options.limit, 20);
  const decks = await fetchDeckAnalytics({ type, source });
  const top = decks.slice(0, limit);

  if (args.flags.json) {
    console.log(JSON.stringify(top, null, 2));
    return;
  }

  const rows = top.map((deck) => {
    const first = deck.matchup?.first;
    const second = deck.matchup?.second;
    const fw = Number(first?.win ?? 0);
    const fl = Number(first?.lose ?? 0);
    const sw = Number(second?.win ?? 0);
    const sl = Number(second?.lose ?? 0);
    return {
      deck: deck.name,
      games: Number(deck.count ?? 0),
      first: formatPercent(fw / (fw + fl)),
      second: formatPercent(sw / (sw + sl)),
      tags: (deck.tags ?? []).slice(0, 2).join(","),
    };
  });
  printTable(rows);
}

function displaySpectatorSummary(collector, args) {
  const snapshot = collector.snapshot();
  if (args.flags.json) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  console.log(`room: ${snapshot.roomId}`);
  console.log(`users: ${snapshot.users.join(" vs ")}`);
  console.log(`rounds: ${snapshot.rounds.length}`);
  for (const round of snapshot.rounds) {
    const winner =
      round.winner === 0 || round.winner === 1
        ? snapshot.users[round.winner]
        : round.winner === 2
          ? "平局"
          : "未结束";
    console.log(
      `${round.roundId} | 先手位置 ${round.firstPosition} | 结果 ${winner} | 起手 ${Object.values(round.openingHands).some((cards) => cards.some(Boolean)) ? "可见" : "被隐藏"} | 观测卡 ${round.observedCards.length}`,
    );
  }
}

async function runWatch(args) {
  const roomId = args._[1];
  if (!roomId) throw new Error("用法: node src/index.js watch <roomId>");

  const host = args.options.host ?? DEFAULT_GAME_HOST;
  const port = num(args.options.port, DEFAULT_GAME_PORT);
  const version = num(args.options.version, PROTOCOL_VERSION);
  const timeoutMs = num(args.options.timeout, 120) * 1000;
  let name;
  let joinPassword;
  let roomInfo;

  if (args.options.password) {
    name = args.options.name ?? "spectator";
    joinPassword = args.options.password;
  } else {
    const auth = await resolveAuth({
      token: args.options.token,
      secret: args.options.secret,
      username: args.options.username,
      storageDir: args.options.storage,
    });
    name = auth.username;
    joinPassword = makeJoinPassword(auth.secret, roomId);
    const rooms = await fetchStartedRooms();
    roomInfo = rooms.find((room) => room.id === roomId);
    if (roomInfo?.options?.no_watch) {
      throw new Error(`该房间禁止观战: ${roomId}`);
    }
  }

  const collector = new DuelCollector({
    roomId,
    users: roomInfo?.users ?? [],
    hostInfo: roomInfo?.options,
  });
  const session = new SpectatorSession({
    host,
    port,
    name,
    joinPassword,
    version,
    timeoutMs,
  });

  session.on("stoc", (stoc) => collector.handleStoc(stoc));
  session.on("error", (error) => {
    console.error(`spectator error: ${error.message}`);
    session.close();
  });
  session.on("timeout", () => {
    console.error("spectator timeout");
    session.close();
  });
  session.on("close", () => {
    displaySpectatorSummary(collector, args);
    if (args.options.save) {
      const file = path.resolve(args.options.save);
      appendRecord(file, collector.snapshot());
      console.log(`saved: ${file}`);
    }
  });

  session.connect();
}

async function runWatchAuto(args) {
  const duration = num(args.options.seconds, 3600);
  const parallel = Math.max(1, Math.min(8, num(args.options.parallel, 2)));
  const pollSeconds = num(args.options.poll, 15);
  const perRoomTimeout = num(args.options.timeout, 180) * 1000;
  const save = args.options.save ?? path.resolve("data", "auto-watch.jsonl");
  const getAuth = () =>
    resolveAuth({
      token: args.options.token,
      secret: args.options.secret,
      username: args.options.username,
      storageDir: args.options.storage,
    });

  const seen = new Set();
  const active = new Set();
  const deadline = Date.now() + duration * 1000;

  const watchOne = async (room) =>
    new Promise((resolve) => {
      if (seen.has(room.id) || room.options?.no_watch || active.size >= parallel) {
        resolve();
        return;
      }
      seen.add(room.id);
      active.add(room.id);

      getAuth()
        .then((auth) => {
          const collector = new DuelCollector({
            roomId: room.id,
            users: room.users ?? [],
          });
          const session = new SpectatorSession({
            host: args.options.host ?? DEFAULT_GAME_HOST,
            port: num(args.options.port, DEFAULT_GAME_PORT),
            name: auth.username,
            joinPassword: makeJoinPassword(auth.secret, room.id),
            timeoutMs: perRoomTimeout,
          });

          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            active.delete(room.id);
            appendRecord(save, collector.snapshot());
            resolve();
          };
          session.on("stoc", (stoc) => collector.handleStoc(stoc));
          session.on("error", finish);
          session.on("timeout", finish);
          session.on("close", finish);
          session.connect();
        })
        .catch((error) => {
          console.error(`auth failed for ${room.id}: ${error.message}`);
          active.delete(room.id);
          resolve();
        });
    });

  console.log(`auto watch: duration=${duration}s parallel=${parallel} save=${save}`);
  while (Date.now() < deadline) {
    try {
      const rooms = await fetchStartedRooms();
      const started = rooms.filter(
        (room) => room.arena && (room.users?.length ?? 0) >= 2 && !seen.has(room.id),
      );
      const capacity = parallel - active.size;
      for (const room of started.slice(0, Math.max(0, capacity))) {
        void watchOne(room);
      }
    } catch (error) {
      console.error(`room poll failed: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
  }

  while (active.size > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const records = loadRecords(save);
  const stats = computeCardStats(records);
  const names = await resolveCardNames(stats.cards.map((item) => item.code));
  const summary = {
    collectedAt: new Date().toISOString(),
    totals: stats.totals,
    cards: stats.cards.map((item) => ({
      code: item.code,
      name: names.get(item.code),
      firstWins: item.firstWins,
      firstTotal: item.firstTotal,
      secondWins: item.secondWins,
      secondTotal: item.secondTotal,
      observedTotal: item.observedTotal,
    })),
  };
  const summaryFile = path.resolve("data", "auto-watch-summary.json");
  writeJson(summaryFile, summary);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`summary: ${summaryFile}`);
}

async function runStats(args) {
  const file = path.resolve(args._[1] ?? "data/auto-watch.jsonl");
  const records = loadRecords(file);
  const stats = computeCardStats(records);
  const names = await resolveCardNames(stats.cards.map((item) => item.code));

  if (args.flags.json) {
    console.log(
      JSON.stringify(
        {
          source: file,
          totals: stats.totals,
          cards: stats.cards.map((item) => ({
            code: item.code,
            name: names.get(item.code),
            firstWins: item.firstWins,
            firstTotal: item.firstTotal,
            secondWins: item.secondWins,
            secondTotal: item.secondTotal,
            observedTotal: item.observedTotal,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`source: ${file}`);
  console.log(
    `rounds=${stats.totals.completedRounds} fullHandRounds=${stats.totals.fullHandRounds} first=${formatPercent(stats.totals.firstWinRate)} second=${formatPercent(stats.totals.secondWinRate)}`,
  );
  printTable(
    stats.cards.map((item) => ({
      code: item.code,
      name: names.get(item.code),
      first: `${item.firstWins}/${item.firstTotal}`,
      firstRate: formatPercent(item.firstWins / item.firstTotal),
      second: `${item.secondWins}/${item.secondTotal}`,
      secondRate: formatPercent(item.secondWins / item.secondTotal),
      observed: item.observedTotal,
    })),
  );
}

const COMMANDS = {
  rooms: runRooms,
  auth: runAuth,
  analytics: runAnalytics,
  watch: runWatch,
  "watch-auto": runWatchAuto,
  stats: runStats,
};

const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? "help";
const handler = COMMANDS[command];

if (!handler) {
  console.log(
    "用法: node src/index.js <rooms|auth|analytics|watch|watch-auto|stats> [options]",
  );
  process.exit(0);
}

handler(args).catch((error) => {
  console.error(error);
  process.exit(1);
});
