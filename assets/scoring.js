// How points work. Pure module, shared by the browser and the nightly job, so the
// numbers on the page and the numbers the job writes can never disagree.
//
//   - Highest Krillion score wins the day.
//   - 1st / 2nd / 3rd get 3 / 2 / 1 points.
//   - Ties share the place and each gets its points; the next place is skipped
//     (scores 900, 900, 800 -> ranks 1, 1, 3 -> points 3, 3, 1).
//   - Anything updated after the day's 18:00 cutoff is ignored entirely.
//   - A day's results become final at 18:01.
//   - Only closed days count towards the overall table.

import { isOnTime, isDayFinal } from './dates.js';
import { countGrid, emptyCounts } from './result.js';

export const PLACE_POINTS = [3, 2, 1];

export function pointsForRank(rank) {
  return PLACE_POINTS[rank - 1] || 0;
}

/**
 * Entries that are allowed to count: a whole, non-negative score that arrived
 * before cutoff. `updatedAt` is ms since epoch.
 */
export function validEntries(entries) {
  return entries.filter(
    (entry) =>
      Number.isInteger(entry.score) && entry.score >= 0 && isOnTime(entry.date, entry.updatedAt)
  );
}

/**
 * Rank one day's entries with standard competition ranking.
 * Returns new objects with `rank` and `points` added, best first.
 */
export function rankDay(entries) {
  const sorted = [...entries].sort(
    (a, b) => b.score - a.score || (a.displayName || '').localeCompare(b.displayName || '')
  );

  let rank = 0;
  return sorted.map((entry, index) => {
    if (index === 0 || entry.score !== sorted[index - 1].score) rank = index + 1;
    return { ...entry, rank, points: pointsForRank(rank) };
  });
}

export function groupByDate(entries) {
  const byDate = new Map();
  for (const entry of entries) {
    if (!byDate.has(entry.date)) byDate.set(entry.date, []);
    byDate.get(entry.date).push(entry);
  }
  return byDate;
}

/**
 * Final results for every closed day among `entries`, newest first:
 * [{ date, entries: [{ uid, displayName, score, rank, points }] }]
 */
export function closedDayResults(entries, now = Date.now()) {
  const days = [];
  for (const [date, dayEntries] of groupByDate(validEntries(entries))) {
    if (!isDayFinal(date, now)) continue;
    days.push({
      date,
      entries: rankDay(dayEntries).map(({ uid, displayName, score, grid, rank, points }) => ({
        uid,
        displayName: displayName || '',
        score,
        grid: grid || '',
        rank,
        points,
      })),
    });
  }
  return days.sort((a, b) => b.date.localeCompare(a.date));
}

function emptyTally(displayName) {
  return { displayName, points: 0, wins: 0, podiums: 0, played: 0, totalScore: 0, best: 0, counts: emptyCounts() };
}

function addCounts(into, from = {}) {
  for (const key of Object.keys(into)) into[key] += from[key] || 0;
}

/** Fold finished days into per-player totals: { uid: tally }. */
export function tallyResults(dayResults) {
  const players = {};
  for (const day of dayResults) {
    for (const entry of day.entries) {
      const tally = (players[entry.uid] ||= emptyTally(entry.displayName));
      if (entry.displayName) tally.displayName = entry.displayName;
      tally.points += entry.points;
      tally.played += 1;
      tally.totalScore += entry.score;
      tally.best = Math.max(tally.best, entry.score);
      if (entry.rank === 1) tally.wins += 1;
      if (entry.rank <= 3) tally.podiums += 1;
      addCounts(tally.counts, countGrid(entry.grid));
    }
  }
  return players;
}

/** Add two tallies together (the job's stored totals + days it hasn't seen yet). */
export function mergeTallies(a = {}, b = {}) {
  const merged = {};
  for (const source of [a, b]) {
    for (const [uid, tally] of Object.entries(source)) {
      const into = (merged[uid] ||= emptyTally(tally.displayName));
      if (tally.displayName) into.displayName = tally.displayName;
      into.points += tally.points || 0;
      into.wins += tally.wins || 0;
      into.podiums += tally.podiums || 0;
      into.played += tally.played || 0;
      into.totalScore += tally.totalScore || 0;
      into.best = Math.max(into.best, tally.best || 0);
      addCounts(into.counts, tally.counts);
    }
  }
  return merged;
}

/**
 * Overall table rows, best first, with shared ranks for genuine ties.
 * Order: points, then wins, then podiums. Name only breaks display order.
 */
export function rankPlayers(tallies) {
  const rows = Object.entries(tallies).map(([uid, tally]) => ({
    uid,
    ...tally,
    average: tally.played ? Math.round(tally.totalScore / tally.played) : 0,
  }));

  const compare = (a, b) => b.points - a.points || b.wins - a.wins || b.podiums - a.podiums;
  rows.sort((a, b) => compare(a, b) || a.displayName.localeCompare(b.displayName));

  let rank = 0;
  return rows.map((row, index) => {
    if (index === 0 || compare(row, rows[index - 1]) !== 0) rank = index + 1;
    return { ...row, rank };
  });
}
