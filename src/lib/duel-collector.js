import {
  YGOProMsgDraw,
  YGOProMsgMove,
  YGOProMsgStart,
  YGOProMsgUpdateCard,
  YGOProMsgUpdateData,
  YGOProMsgWin,
  YGOProStocGameMsg,
  YGOProStocJoinGame,
} from "ygopro-msg-encode";

function safeCode(value) {
  const code = Number(value ?? 0);
  return Number.isInteger(code) && code > 0 ? code : 0;
}

function collectCode(target, code, player) {
  const valid = safeCode(code);
  if (!valid) return;
  const key = player === 0 || player === 1 ? player : undefined;
  const players = target.get(valid) ?? new Set();
  if (key !== undefined) players.add(key);
  target.set(valid, players);
}

export class DuelCollector {
  constructor({ roomId, users = [], hostInfo } = {}) {
    this.roomId = roomId;
    this.users = users;
    this.hostInfo = hostInfo;
    this.rounds = [];
    this.currentRound = null;
    this.lastError = null;
  }

  handleStoc(stoc) {
    if (stoc instanceof YGOProStocJoinGame) {
      this.hostInfo = stoc.info;
      return;
    }
    if (!(stoc instanceof YGOProStocGameMsg)) return;
    this.handleGameMessage(stoc.msg);
  }

  handleGameMessage(msg) {
    if (!msg) return;

    if (msg instanceof YGOProMsgStart) {
      const swapped = msg.playerNumber === 1;
      this.currentRound = {
        roundId: `round-${this.rounds.length + 1}`,
        startedAt: new Date().toISOString(),
        swapped,
        firstPosition: swapped ? 1 : 0,
        secondPosition: swapped ? 0 : 1,
        startHand: this.hostInfo?.start_hand ?? 5,
        startLp: [msg.startLp0, msg.startLp1],
        deckCounts: [
          { main: msg.player0?.deckCount ?? 0, extra: msg.player0?.extraCount ?? 0 },
          { main: msg.player1?.deckCount ?? 0, extra: msg.player1?.extraCount ?? 0 },
        ],
        openingHands: { 0: [], 1: [] },
        drawEvents: [],
        winner: undefined,
        winType: undefined,
        observedCards: new Map(),
      };
      this.rounds.push(this.currentRound);
      return;
    }

    const round = this.currentRound;
    if (!round) return;

    if (msg instanceof YGOProMsgDraw) {
      const player = msg.player;
      const cards = (msg.cards ?? []).map(safeCode);
      round.drawEvents.push({ player, count: msg.count, cards, at: new Date().toISOString() });

      if (
        (player === 0 || player === 1) &&
        round.openingHands[player].length === 0 &&
        cards.some((code) => code !== 0)
      ) {
        round.openingHands[player] = cards;
      }
      for (const code of cards) collectCode(round.observedCards, code, player);
      return;
    }

    if (msg instanceof YGOProMsgWin) {
      round.winner = msg.player;
      round.winType = msg.type;
      round.endedAt = new Date().toISOString();
      return;
    }

    if (msg instanceof YGOProMsgMove) {
      const player =
        msg.current?.controller ?? msg.previous?.controller ?? undefined;
      collectCode(round.observedCards, msg.code, player);
      return;
    }

    if (msg instanceof YGOProMsgUpdateData) {
      for (const card of msg.cards ?? []) {
        collectCode(round.observedCards, card.code, card.controller ?? msg.player);
      }
      return;
    }

    if (msg instanceof YGOProMsgUpdateCard) {
      collectCode(round.observedCards, msg.card?.code, msg.controller);
      return;
    }

    // Generic fallback for message types whose binary layout exposes a code.
    if (typeof msg.code === "number") {
      const player =
        typeof msg.controller === "number"
          ? msg.controller
          : typeof msg.player === "number"
            ? msg.player
            : undefined;
      collectCode(round.observedCards, msg.code, player);
    }
  }

  snapshot() {
    return {
      roomId: this.roomId,
      users: this.users.map((user) => user?.username ?? user),
      hostInfo: this.hostInfo,
      rounds: this.rounds.map((round) => ({
        ...round,
        observedCards: [...round.observedCards.entries()].map(([code, value]) => ({
          code,
          count: 1,
          players: [...value],
        })),
      })),
    };
  }
}
