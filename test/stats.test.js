import test from "node:test";
import assert from "node:assert/strict";
import { computeCardStats } from "../src/lib/stats.js";

test("computes first/second win rate from full hands", () => {
  const record = {
    rounds: [
      {
        firstPosition: 0,
        secondPosition: 1,
        winner: 0,
        openingHands: { 0: [1, 2], 1: [3] },
        observedCards: [],
      },
      {
        firstPosition: 1,
        secondPosition: 0,
        winner: 1,
        openingHands: { 0: [1], 1: [2, 3] },
        observedCards: [],
      },
    ],
  };

  const stats = computeCardStats([record], { includeObservedCards: false });
  assert.equal(stats.totals.firstWins, 2);
  assert.equal(stats.totals.secondWins, 0);
  assert.equal(stats.cards.find((item) => item.code === 1).firstTotal, 2);
  assert.equal(stats.cards.find((item) => item.code === 1).firstWins, 2);
});

test("counts observed cards even when opening hand is masked", () => {
  const record = {
    rounds: [
      {
        firstPosition: 0,
        secondPosition: 1,
        winner: 0,
        openingHands: { 0: [0, 0, 0, 0, 0], 1: [0, 0, 0, 0, 0] },
        observedCards: [{ code: 42, count: 3, players: [0] }],
      },
    ],
  };

  const stats = computeCardStats([record]);
  assert.equal(stats.totals.fullHandRounds, 0);
  assert.equal(stats.cards.find((item) => item.code === 42).observedTotal, 3);
});
