import { EventEmitter } from "node:events";
import net from "node:net";
import { PROTOCOL_VERSION } from "./constants.js";
import { extractGameMessage, makeSpectatorPackets, parseStocPacket } from "./protocol.js";

export class SpectatorSession extends EventEmitter {
  constructor({
    host,
    port,
    name,
    joinPassword,
    version = PROTOCOL_VERSION,
    timeoutMs = 120000,
  }) {
    super();
    this.host = host;
    this.port = port;
    this.name = name;
    this.joinPassword = joinPassword;
    this.version = version;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.connected = false;
    this.timer = null;
  }

  connect() {
    this.socket = net.createConnection({ host: this.host, port: this.port });
    this.socket.setNoDelay(true);
    this.timer = setTimeout(() => {
      this.emit("timeout");
      this.close();
    }, this.timeoutMs);

    this.socket.on("connect", () => {
      this.connected = true;
      this.emit("connect");
      for (const packet of makeSpectatorPackets({
        name: this.name,
        joinPassword: this.joinPassword,
        version: this.version,
      })) {
        this.socket.write(packet);
      }
    });

    this.socket.on("data", (chunk) => this._onData(chunk));
    this.socket.on("error", (error) => this.emit("error", error));
    this.socket.on("close", () => {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.connected = false;
      this.emit("close");
    });

    return this;
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const packetLength = this.buffer.readUInt16LE(0);
      const total = packetLength + 2;
      if (this.buffer.length < total) break;

      const frame = this.buffer.subarray(0, total);
      this.buffer = this.buffer.subarray(total);
      const stoc = parseStocPacket(frame);
      if (!stoc) continue;

      this.emit("stoc", stoc);
      const gameMessage = extractGameMessage(stoc);
      if (gameMessage) this.emit("game-message", gameMessage, stoc);
    }
  }

  close() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.socket && !this.socket.destroyed) {
      this.socket.end();
      this.socket.destroy();
    }
  }
}

export function watchRoom({
  host,
  port,
  name,
  joinPassword,
  version = PROTOCOL_VERSION,
  timeoutMs = 120000,
  onStoc,
  onGameMessage,
  onError,
}) {
  return new Promise((resolve) => {
    let settled = false;
    const session = new SpectatorSession({
      host,
      port,
      name,
      joinPassword,
      version,
      timeoutMs,
    });

    session.on("stoc", (stoc) => onStoc?.(stoc));
    session.on("game-message", (msg, stoc) => onGameMessage?.(msg, stoc));
    session.on("error", (error) => {
      if (settled) return;
      settled = true;
      onError?.(error);
      resolve({ ok: false, error });
    });
    session.on("timeout", () => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: new Error("观战超时") });
    });
    session.on("close", () => {
      if (settled) return;
      settled = true;
      resolve({ ok: true });
    });

    session.connect();
  });
}
