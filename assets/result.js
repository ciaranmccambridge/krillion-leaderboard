// Parses the text from Krillion's "Copy your result" button, e.g.
//
//   Krillion ∞ #1 🦐
//   180
//
//   🦑⬛🦑🐟🫧🫧🫧
//
// Pure module so it can be tested in node.

const MAX_SCORE = 10_000_000;

// What each emoji in the dive log means, rarest first. The game's dive log
// plots them by depth (deeper = rarer). This is the only place the mapping
// lives: change it here and the leaderboard follows.
export const CATEGORIES = [
  { key: 'krillion', label: 'Krillion', emoji: '🌟' },
  { key: 'deepCut', label: 'Deep cut', emoji: '🏮' },
  { key: 'rare', label: 'Rare', emoji: '🦑' },
  { key: 'schooler', label: 'Schooler', emoji: '🐟' },
  { key: 'plankton', label: 'Plankton', emoji: '🫧' },
];
export const MISS_EMOJI = '⬛';

const BY_EMOJI = new Map(CATEGORIES.map((category) => [category.emoji, category.key]));
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

// Slack, Discord, GitHub and some Linux setups copy emoji as text shortcodes
// (":fish:" instead of 🐟). These are the standard names for every emoji
// Krillion uses, plus common aliases, so a pasted result reads the same either
// way. Unknown shortcodes are left as they are.
const SHORTCODES = {
  shrimp: '🦐',
  black_large_square: '⬛',
  large_black_square: '⬛',
  black_square: '⬛',
  bubbles: '🫧',
  fish: '🐟',
  squid: '🦑',
  izakaya_lantern: '🏮',
  red_paper_lantern: '🏮',
  lantern: '🏮',
  star2: '🌟',
  glowing_star: '🌟',
};
const SHORTCODE = /:([a-z0-9_+-]+):/gi;

/** ':fish::bubbles:' -> '🐟🫧' */
export function expandShortcodes(text) {
  return String(text || '').replace(SHORTCODE, (match, name) => SHORTCODES[name.toLowerCase()] ?? match);
}

/** '#126 :shrimp:' -> '#126'. Also tidies dive labels saved before shortcodes were understood. */
export function cleanPuzzle(puzzle) {
  return String(puzzle || '')
    .replace(SHORTCODE, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function emptyCounts() {
  return Object.fromEntries([...CATEGORIES.map((c) => [c.key, 0]), ['miss', 0]]);
}

/** '⬛🫧🐟🦑🏮🌟🌟' -> { krillion: 2, deepCut: 1, rare: 1, schooler: 1, plankton: 1, miss: 1 } */
export function countGrid(grid) {
  const counts = emptyCounts();
  for (const { segment } of graphemes.segment(String(grid || ''))) {
    const emoji = segment.replace(/️/g, ''); // ignore variation selectors
    if (emoji === MISS_EMOJI) counts.miss += 1;
    else if (BY_EMOJI.has(emoji)) counts[BY_EMOJI.get(emoji)] += 1;
  }
  return counts;
}

/**
 * Returns { score, puzzle, grid } on success, or { error } with a message
 * suitable for showing to the person.
 */
export function parseResult(text) {
  const lines = expandShortcodes(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const headerIndex = lines.findIndex((line) => /krillion/i.test(line));
  if (headerIndex === -1) {
    return { error: 'That doesn’t look like a Krillion result. Use “Copy your result” in the game, then paste here.' };
  }

  // The daily dive reads "Krillion #126"; Endless Dive runs read "Krillion ∞ #1".
  if (lines[headerIndex].includes('∞')) {
    return { error: 'That’s an Endless Dive result. Only the daily dive counts, so paste today’s daily result instead.' };
  }

  // "Krillion #126 🦐" -> "#126". Emoji (and any unknown shortcodes) are dropped.
  const puzzle = cleanPuzzle(lines[headerIndex].replace(/krillion/i, '')).slice(0, 40);

  const rest = lines.slice(headerIndex + 1);
  const scoreIndex = rest.findIndex((line) => /^\d{1,3}(,\d{3})+$|^\d+$/.test(line));
  if (scoreIndex === -1) {
    return { error: 'Couldn’t find your score in that. Paste the whole result, straight from the game.' };
  }

  const score = Number(rest[scoreIndex].replace(/,/g, ''));
  if (!Number.isSafeInteger(score) || score > MAX_SCORE) {
    return { error: 'That score looks wrong. Paste the result straight from the game.' };
  }

  // The dive log: the first line after the score with no letters or digits
  // (ignoring any shortcodes we didn't recognise, which are kept so they show).
  const grid = (
    rest.slice(scoreIndex + 1).find((line) => !/[\p{L}\p{N}]/u.test(line.replace(SHORTCODE, ''))) || ''
  ).slice(0, 120);

  return { score, puzzle, grid };
}
