// Run: node tests/names.test.mjs
// Telling people with the same first name apart.

import { createChecker } from './helpers.mjs';
import { displayNames, baseName } from '../assets/names.js';

const { check, report } = createChecker('names');
const user = (googleName, nickname = googleName.split(' ')[0]) => ({ googleName, nickname });

check('no clash: first names only', displayNames({
  a: user('Ciaran Murphy'),
  b: user('Dave Smith'),
}), { a: 'Ciaran', b: 'Dave' });

check('clash: one surname letter is enough', displayNames({
  a: user('Ciaran Murphy'),
  b: user("Ciaran O'Neill"),
  c: user('Dave Smith'),
}), { a: 'Ciaran M.', b: 'Ciaran O.', c: 'Dave' });

check('clash: same first letter, uses two', displayNames({
  a: user('Ciaran McCann'),
  b: user('Ciaran Martin'),
}), { a: 'Ciaran Mc.', b: 'Ciaran Ma.' });

check('three-way clash, all use the same number of letters', displayNames({
  a: user('Sean Kelly'),
  b: user('Sean Kearney'),
  c: user('Sean Byrne'),
}), { a: 'Sean Kel.', b: 'Sean Kea.', c: 'Sean Byr.' });

check('short surname shown whole, no dot', displayNames({
  a: user('Jo Li'),
  b: user('Jo Lim'),
}), { a: 'Jo Li', b: 'Jo Lim' });

check('middle names ignored: surname is the last word', displayNames({
  a: user('Mary Anne Walsh'),
  b: user('Mary Doyle'),
}), { a: 'Mary W.', b: 'Mary D.' });

check('clash is case-insensitive', displayNames({
  a: user('ciaran murphy', 'ciaran'),
  b: user('Ciaran Kelly', 'Ciaran'),
}), { a: 'ciaran m.', b: 'Ciaran K.' });

check('a unique custom nickname needs no surname', displayNames({
  a: user('Ciaran Murphy', 'Big C'),
  b: user('Ciaran Kelly'),
}), { a: 'Big C', b: 'Ciaran' });

check('identical full names stay identical (rename to fix)', displayNames({
  a: user('John Smith'),
  b: user('John Smith'),
}), { a: 'John Smith', b: 'John Smith' });

check('no surname on Google account', displayNames({
  a: user('Cher'),
  b: user('Cher Lloyd', 'Cher'),
}), { a: 'Cher', b: 'Cher L.' });

check('no nickname falls back to Google first name', baseName({ googleName: 'Aoife Byrne' }), 'Aoife');
check('nothing at all', baseName({}), 'Someone');
check('empty users', displayNames({}), {});

report();
