// Run: node tests/scoring.test.mjs
// Points, ties, the 18:00 cutoff / 18:01 results, and how the overall table adds up.

import { createChecker } from './helpers.mjs';
import { rankDay, validEntries, closedDayResults, tallyResults, mergeTallies, rankPlayers } from '../assets/scoring.js';

const { check, report } = createChecker('scoring');

// Winter dates, so London time == UTC.
const at = (date, time = '12:00') => Date.parse(`${date}T${time}:00Z`);
const entry = (uid, score, date = '2026-01-15', time = '12:00', grid = '') => ({
  uid, displayName: uid, score, date, grid, updatedAt: at(date, time),
});
const summary = (ranked) => ranked.map((e) => `${e.uid}:${e.rank}:${e.points}`);

// --- single day
check('plain podium', summary(rankDay([entry('a', 500), entry('b', 900), entry('c', 700), entry('d', 100)])),
  ['b:1:3', 'c:2:2', 'a:3:1', 'd:4:0']);
check('tie for first: both get 3, next gets 1', summary(rankDay([entry('a', 900), entry('b', 900), entry('c', 800)])),
  ['a:1:3', 'b:1:3', 'c:3:1']);
check('tie for second', summary(rankDay([entry('a', 900), entry('b', 800), entry('c', 800), entry('d', 700)])),
  ['a:1:3', 'b:2:2', 'c:2:2', 'd:4:0']);
check('tie for third: both get 1', summary(rankDay([entry('a', 9), entry('b', 8), entry('c', 7), entry('d', 7), entry('e', 1)])),
  ['a:1:3', 'b:2:2', 'c:3:1', 'd:3:1', 'e:5:0']);
check('three-way tie for first', summary(rankDay([entry('a', 5), entry('b', 5), entry('c', 5), entry('d', 4)])),
  ['a:1:3', 'b:1:3', 'c:1:3', 'd:4:0']);
check('fewer than three players', summary(rankDay([entry('a', 10), entry('b', 20)])), ['b:1:3', 'a:2:2']);
check('nobody played', rankDay([]), []);

// --- cutoff
check('late update is dropped', validEntries([entry('a', 1, '2026-01-15', '17:59'), entry('b', 2, '2026-01-15', '18:01')]).map((e) => e.uid), ['a']);
check('non-integer score is dropped', validEntries([{ ...entry('a', 1), score: 1.5 }]).length, 0);

// --- closed days
const now = at('2026-01-16', '10:00'); // the 16th is still open
const all = [
  entry('a', 900, '2026-01-14'), entry('b', 800, '2026-01-14'), entry('c', 700, '2026-01-14'),
  entry('b', 950, '2026-01-15'), entry('a', 950, '2026-01-15'), entry('c', 10, '2026-01-15'),
  entry('c', 99999, '2026-01-16'), // today: provisional, must not count yet
];
const days = closedDayResults(all, now);
check('only closed days, newest first', days.map((d) => d.date), ['2026-01-15', '2026-01-14']);

const table = rankPlayers(tallyResults(days));
check('overall points', table.map((r) => `${r.uid}:${r.points}`), ['a:6', 'b:5', 'c:2']);
check('wins counts shared wins', table.map((r) => r.wins), [2, 1, 0]);
check('podiums + played', table.map((r) => [r.podiums, r.played]), [[2, 2], [2, 2], [2, 2]]);
check('average', table.find((r) => r.uid === 'c').average, 355);

check('today not counted at 18:00 (closed, not yet final)', closedDayResults(all, at('2026-01-16', '18:00')).length, 2);
check('today counts from 18:01', closedDayResults(all, at('2026-01-16', '18:01')).length, 3);

// --- stored standings + unprocessed days add up to a full recompute
const older = tallyResults(closedDayResults(all.filter((e) => e.date <= '2026-01-14'), now));
const newer = tallyResults(closedDayResults(all.filter((e) => e.date > '2026-01-14'), now));
check('merge == recompute', rankPlayers(mergeTallies(older, newer)), table);
check('merge with nothing stored', rankPlayers(mergeTallies(undefined, newer)).map((r) => r.uid), ['a', 'b', 'c']);

// --- category counts add up across days, and survive the stored/fresh merge
const logs = [
  entry('a', 300, '2026-01-14', '12:00', '🌟🏮🫧'),
  entry('a', 200, '2026-01-15', '12:00', '🌟🐟⬛'),
  entry('a', 999, '2026-01-15', '18:30', '🌟🌟🌟'), // late: must not count
  entry('b', 100, '2026-01-15', '12:00', '🦑🫧🫧'),
];
const counted = rankPlayers(tallyResults(closedDayResults(logs, now)));
check('counts summed per player', counted.find((r) => r.uid === 'a').counts,
  { krillion: 2, deepCut: 1, rare: 0, schooler: 1, plankton: 1, miss: 1 });
check('other player counted separately', counted.find((r) => r.uid === 'b').counts,
  { krillion: 0, deepCut: 0, rare: 1, schooler: 0, plankton: 2, miss: 0 });
const split = rankPlayers(mergeTallies(
  tallyResults(closedDayResults(logs.filter((e) => e.date <= '2026-01-14'), now)),
  tallyResults(closedDayResults(logs.filter((e) => e.date > '2026-01-14'), now)),
));
check('counts: merge == recompute', split, counted);
check('standings saved before counts existed still merge',
  mergeTallies({ old: { displayName: 'Old', points: 3, wins: 1, podiums: 1, played: 1, totalScore: 5, best: 5 } }).old.counts.krillion, 0);

// --- overall ties
const tied = rankPlayers({
  x: { displayName: 'X', points: 6, wins: 1, podiums: 3, played: 3, totalScore: 3, best: 1 },
  y: { displayName: 'Y', points: 6, wins: 1, podiums: 3, played: 3, totalScore: 3, best: 1 },
  z: { displayName: 'Z', points: 6, wins: 2, podiums: 2, played: 3, totalScore: 3, best: 1 },
});
check('overall: wins break points ties, exact ties share rank', tied.map((r) => `${r.uid}:${r.rank}`), ['z:1', 'x:2', 'y:2']);

report();
