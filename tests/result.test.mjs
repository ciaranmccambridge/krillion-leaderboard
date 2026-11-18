// Run: node tests/result.test.mjs
// Parsing the text from Krillion's "Copy your result" button.

import { createChecker } from './helpers.mjs';
import { parseResult, countGrid } from '../assets/result.js';

const { check, report } = createChecker('result');

// Copied verbatim from the game.
const REAL = 'Krillion #126 🦐\n385\n\n⬛🫧🐟🦑🏮🌟🌟';
const ENDLESS = 'Krillion ∞ #1 🦐\n180\n\n🦑⬛🦑🐟🫧🫧🫧';

check('real daily result', parseResult(REAL), { score: 385, puzzle: '#126', grid: '⬛🫧🐟🦑🏮🌟🌟' });
check('Windows line endings', parseResult(REAL.replace(/\n/g, '\r\n')).score, 385);
check('surrounding chatter is ignored', parseResult(`my best yet!\n${REAL}\nbeat that`).score, 385);
check('Endless Dive results are rejected', /Endless/.test(parseResult(ENDLESS).error), true);
check('thousands separator', parseResult('Krillion #312 🦐\n1,240\n🐟').score, 1240);
check('no dive log is fine', parseResult('Krillion #5\n42'), { score: 42, puzzle: '#5', grid: '' });
check('zero is a score', parseResult('Krillion #5\n0\n🫧🫧').score, 0);

check('just a number is rejected', Boolean(parseResult('180').error), true);
check('header but no score', Boolean(parseResult('Krillion #1 🦐\n🦑⬛').error), true);
check('empty', Boolean(parseResult('').error), true);
check('decimal is not a score', Boolean(parseResult('Krillion #1\n18.5').error), true);

// --- dive log -> category counts
check('every category in the real result', countGrid('⬛🫧🐟🦑🏮🌟🌟'),
  { krillion: 2, deepCut: 1, rare: 1, schooler: 1, plankton: 1, miss: 1 });
check('repeats', countGrid('🦑⬛🦑🐟🫧🫧🫧'), { krillion: 0, deepCut: 0, rare: 2, schooler: 1, plankton: 3, miss: 1 });
check('variation selectors ignored', countGrid('🌟\uFE0F⬛\uFE0F').krillion, 1);
check('unknown emoji ignored', countGrid('🦐🐙x').krillion + countGrid('🦐🐙x').miss, 0);
check('empty log', countGrid(''), { krillion: 0, deepCut: 0, rare: 0, schooler: 0, plankton: 0, miss: 0 });

report();
