function roundWinnerPosition(round) {
  const winner = round.winner;
  if (winner === 0 || winner === 1) return winner;
  return undefined;
}

function positionForInternalPlayer(round, internalPlayer) {
  return internalPlayer === 0 ? round.firstPosition : round.secondPosition;
}

export function computeCardStats(records, options = {}) {
  const byCard = new Map();
  let fullHandRounds = 0;
  let completedRounds = 0;
  let firstWins = 0;
  let firstGames = 0;
  let secondWins = 0;
  let secondGames = 0;

  for (const record of records) {
    for (const round of record.rounds ?? []) {
      const winnerPosition = roundWinnerPosition(round);
      if (winnerPosition !== undefined) {
        completedRounds += 1;
        if (winnerPosition === round.firstPosition) firstWins += 1;
        if (winnerPosition === round.secondPosition) secondWins += 1;
        firstGames += 1;
        secondGames += 1;
      }

      const openingEntries = Object.entries(round.openingHands ?? {});
      const hasFullHand = openingEntries.some(([, cards]) => cards?.some((code) => code !== 0));
      if (hasFullHand) fullHandRounds += 1;

      for (const [internalPlayer, cards] of openingEntries) {
        const position = positionForInternalPlayer(round, Number(internalPlayer));
        const won = winnerPosition === position;
        for (const code of cards ?? []) {
          if (!code) continue;
          const item = byCard.get(code) ?? {
            code,
            firstTotal: 0,
            firstWins: 0,
            secondTotal: 0,
            secondWins: 0,
            observedTotal: 0,
          };
          if (position === round.firstPosition) {
            item.firstTotal += 1;
            if (won) item.firstWins += 1;
          } else {
            item.secondTotal += 1;
            if (won) item.secondWins += 1;
          }
          item.observedTotal += 1;
          byCard.set(code, item);
        }
      }

      if (options.includeObservedCards !== false) {
        for (const observed of round.observedCards ?? []) {
          const item = byCard.get(observed.code) ?? {
            code: observed.code,
            firstTotal: 0,
            firstWins: 0,
            secondTotal: 0,
            secondWins: 0,
            observedTotal: 0,
          };
          item.observedTotal += observed.count;
          byCard.set(observed.code, item);
        }
      }
    }
  }

  return {
    cards: [...byCard.values()].sort(
      (a, b) =>
        b.observedTotal - a.observedTotal ||
        b.firstTotal - a.firstTotal ||
        a.code - b.code,
    ),
    totals: {
      completedRounds,
      fullHandRounds,
      firstWins,
      firstGames,
      secondWins,
      secondGames,
      firstWinRate: firstGames ? firstWins / firstGames : undefined,
      secondWinRate: secondGames ? secondWins / secondGames : undefined,
    },
  };
}

export function rate(win, total) {
  if (!total) return undefined;
  return win / total;
}

export function formatPercent(value, digits = 1) {
  if (value === undefined || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}
