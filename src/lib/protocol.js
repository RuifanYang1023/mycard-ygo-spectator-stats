import { YGOProCtosHsToObserver, YGOProCtosJoinGame, YGOProCtosPlayerInfo, YGOProStoc, YGOProStocGameMsg } from "ygopro-msg-encode";

export function makeSecretToken(secret) {
  const id = Number(secret);
  if (!Number.isInteger(id) || id <= 0) {
    throw new TypeError(`u16Secret must be a positive integer, got ${secret}`);
  }

  const b = Buffer.from([0xd0, 0x30, 0, 0, 0, 0]);
  const r = (id % 0xffff) + 1;
  for (let t = 0; t < 6; t += 2) {
    const k = ((b[t + 1] << 8) | b[t]) ^ r;
    b[t] = k & 0xff;
    b[t + 1] = (k >>> 8) & 0xff;
  }
  return b.toString("base64");
}

export function makeJoinPassword(secret, roomId) {
  return `${makeSecretToken(secret)}${roomId}`;
}

export function makeSpectatorPackets({ name, joinPassword, version }) {
  const playerInfo = new YGOProCtosPlayerInfo();
  playerInfo.name = name;

  const joinGame = new YGOProCtosJoinGame();
  joinGame.version = version;
  joinGame.gameid = 0;
  joinGame.pass = joinPassword;

  const toObserver = new YGOProCtosHsToObserver();

  return [
    playerInfo.toFullPayload(),
    joinGame.toFullPayload(),
    toObserver.toFullPayload(),
  ];
}

export function parseStocPacket(frame) {
  if (!(frame instanceof Uint8Array) || frame.length < 3) {
    return undefined;
  }

  const declared = frame[0] | (frame[1] << 8);
  if (declared + 2 !== frame.length) {
    return undefined;
  }

  try {
    return YGOProStoc.getInstanceFromPayload(frame);
  } catch {
    return undefined;
  }
}

export function extractGameMessage(stoc) {
  if (stoc instanceof YGOProStocGameMsg) {
    return stoc.msg;
  }
  return undefined;
}

export function decodeUtf16Name(value) {
  if (typeof value === "string") return value;
  if (!value) return "";
  const chars = Array.from(value);
  let out = "";
  for (let i = 0; i < chars.length; i += 1) {
    const code = typeof chars[i] === "number" ? chars[i] : chars[i].charCodeAt(0);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}
