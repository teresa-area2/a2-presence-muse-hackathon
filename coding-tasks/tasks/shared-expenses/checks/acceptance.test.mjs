import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const base = process.env.TASK_PROJECT_DIR ?? fileURLToPath(new URL('../project/',import.meta.url));
const {settleTrip} = await import(pathToFileURL(path.resolve(base, 'src/settle.mjs')));

const balance = (person, balanceCents) => ({person, balanceCents});
const transfer = (from, to, amountCents) => ({from, to, amountCents});
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

test('an empty trip includes every person in canonical order', () => {
  assert.deepEqual(settleTrip({people: ['cara', 'alice', 'ben'], expenses: []}), {
    balances: [balance('alice', 0), balance('ben', 0), balance('cara', 0)], transfers: []
  });
});

test('apartment and subgroup dinner settle the worked trip correctly', () => {
  assert.deepEqual(settleTrip({people: ['cara', 'alice', 'ben'], expenses: [
    {paidBy: 'alice', amountCents: 9000},
    {paidBy: 'ben', amountCents: 3000, sharedBy: ['cara', 'ben']}
  ]}), {
    balances: [balance('alice', 6000), balance('ben', -1500), balance('cara', -4500)],
    transfers: [transfer('ben', 'alice', 1500), transfer('cara', 'alice', 4500)]
  });
});

test('integer remainder cents follow canonical IDs rather than input order', () => {
  const expected = {balances: [balance('alice', 3), balance('ben', -2), balance('cara', -1)],
    transfers: [transfer('ben', 'alice', 2), transfer('cara', 'alice', 1)]};
  for (const people of [['cara', 'alice', 'ben'], ['ben', 'cara', 'alice']]) {
    assert.deepEqual(settleTrip({people, expenses: [{paidBy: 'alice', amountCents: 5}]}), expected);
    assert.deepEqual(settleTrip({people, expenses: [{paidBy: 'alice', amountCents: 5, sharedBy: [...people].reverse()}]}), expected);
  }
  assert.deepEqual(settleTrip({people: ['cara', 'alice', 'ben'], expenses: [{paidBy: 'cara', amountCents: 1}]}), {
    balances: [balance('alice', -1), balance('ben', 0), balance('cara', 1)],
    transfers: [transfer('alice', 'cara', 1)]
  });
});

test('a payer outside a sharing subgroup is repaid only by that subgroup', () => {
  assert.deepEqual(settleTrip({people: ['alice', 'ben', 'cara'], expenses: [
    {paidBy: 'alice', amountCents: 500, sharedBy: ['cara', 'ben'], label: 'Museum'}
  ]}), {balances: [balance('alice', 500), balance('ben', -250), balance('cara', -250)],
    transfers: [transfer('ben', 'alice', 250), transfer('cara', 'alice', 250)]});
});

test('multiple debtors and creditors use the specified settlement order', () => {
  const expenses = [
    {paidBy: 'alice', amountCents: 300, sharedBy: ['cara']},
    {paidBy: 'ben', amountCents: 400, sharedBy: ['dan']},
    {paidBy: 'cara', amountCents: 100, sharedBy: ['ben']}
  ];
  const expected = {balances: [balance('alice', 300), balance('ben', 300), balance('cara', -200), balance('dan', -400)],
    transfers: [transfer('cara', 'alice', 200), transfer('dan', 'alice', 100), transfer('dan', 'ben', 300)]};
  assert.deepEqual(settleTrip({people: ['dan', 'cara', 'ben', 'alice'], expenses}), expected);
  assert.deepEqual(settleTrip({people: ['alice', 'ben', 'cara', 'dan'], expenses: [...expenses].reverse()}), expected);
});

test('offsetting payments and a solo trip create no zero or self transfers', () => {
  assert.deepEqual(settleTrip({people: ['cara', 'ben', 'alice'], expenses: [
    {paidBy: 'cara', amountCents: 300}, {paidBy: 'alice', amountCents: 300}, {paidBy: 'ben', amountCents: 300}
  ]}), {balances: [balance('alice', 0), balance('ben', 0), balance('cara', 0)], transfers: []});
  assert.deepEqual(settleTrip({people: ['alice'], expenses: [{paidBy: 'alice', amountCents: 1000000000}]}), {
    balances: [balance('alice', 0)], transfers: []
  });
});

test('maximum supported inputs conserve exact safe-integer cents', () => {
  const people = Array.from({length: 20}, (_, i) => 'person-' + String(i).padStart(2, '0'));
  const result = settleTrip({people: [...people].reverse(), expenses: Array.from({length: 200}, () => ({paidBy: people[0], amountCents: 1000000000}))});
  assert.deepEqual(result, {
    balances: people.map((person, i) => balance(person, i === 0 ? 190000000000 : -10000000000)),
    transfers: people.slice(1).map(person => transfer(person, people[0], 10000000000))
  });
  const remaining = new Map(result.balances.map(row => [row.person, row.balanceCents]));
  assert.equal(result.balances.reduce((sum, row) => sum + row.balanceCents, 0), 0);
  for (const row of result.transfers) {
    assert.ok(Number.isSafeInteger(row.amountCents) && row.amountCents > 0);
    assert.notEqual(row.from, row.to);
    remaining.set(row.from, remaining.get(row.from) + row.amountCents);
    remaining.set(row.to, remaining.get(row.to) - row.amountCents);
  }
  assert.deepEqual([...remaining.values()], Array(20).fill(0));
});

test('frozen nested inputs and ignored metadata remain unchanged', () => {
  const input = freeze({people: ['cara', 'alice', 'ben'], expenses: [
    {paidBy: 'alice', amountCents: 5, sharedBy: ['cara', 'alice', 'ben'], metadata: {label: 'Snack'}}
  ]});
  const before = JSON.stringify(input);
  assert.deepEqual(settleTrip(input), {balances: [balance('alice', 3), balance('ben', -2), balance('cara', -1)],
    transfers: [transfer('ben', 'alice', 2), transfer('cara', 'alice', 1)]});
  assert.equal(JSON.stringify(input), before);
  const nullExpense = Object.assign(Object.create(null), {paidBy: 'alice', amountCents: 2});
  assert.deepEqual(settleTrip({people: ['ben', 'alice'], expenses: [nullExpense]}), {
    balances: [balance('alice', 1), balance('ben', -1)], transfers: [transfer('ben', 'alice', 1)]
  });
});

test('invalid collections, identifiers, sharing groups and amounts throw TypeError', () => {
  const valid = () => ({people: ['alice', 'ben'], expenses: [{paidBy: 'alice', amountCents: 100}]});
  const bad = [null, undefined, [], {}, {people: [], expenses: []}, {people: 'alice', expenses: []},
    {people: ['alice', 'alice'], expenses: []}, {people: ['Alice'], expenses: []},
    {people: ['a'.repeat(33)], expenses: []}, {people: [7], expenses: []},
    {people: Array.from({length: 21}, (_, i) => 'p-' + i), expenses: []},
    {people: ['alice'], expenses: {}}, {people: ['alice'], expenses: Array(201).fill({paidBy: 'alice', amountCents: 1})}];
  for (const item of [null, [], new Date(), new (class Expense {constructor(){this.paidBy='alice';this.amountCents=100;}})(), {},
    {paidBy: 'unknown', amountCents: 100}, {paidBy: 'alice', amountCents: 100, sharedBy: []},
    {paidBy: 'alice', amountCents: 100, sharedBy: ['alice', 'alice']},
    {paidBy: 'alice', amountCents: 100, sharedBy: ['unknown']},
    {paidBy: 'alice', amountCents: 100, sharedBy: 'alice'},
    {paidBy: 'alice', amountCents: 100, sharedBy: undefined}]) {
    const input = valid(); input.expenses = [item]; bad.push(input);
  }
  for (const amountCents of [0, -1, 1.5, 1000000001, NaN, Infinity, '100', null, undefined]) {
    const input = valid(); input.expenses[0].amountCents = amountCents; bad.push(input);
  }
  for (const input of bad) assert.throws(() => settleTrip(input), TypeError);
});

test('fresh output objects prevent one result from corrupting a later settlement', () => {
  const input = {people: ['alice', 'ben'], expenses: [{paidBy: 'alice', amountCents: 200}]};
  const first = settleTrip(input);
  assert.deepEqual(first, {balances: [balance('alice', 100), balance('ben', -100)], transfers: [transfer('ben', 'alice', 100)]});
  first.balances[0].balanceCents = 999; first.transfers[0].amountCents = 999;
  assert.deepEqual(settleTrip(input), {balances: [balance('alice', 100), balance('ben', -100)], transfers: [transfer('ben', 'alice', 100)]});
  assert.deepEqual(input, {people: ['alice', 'ben'], expenses: [{paidBy: 'alice', amountCents: 200}]});
});
