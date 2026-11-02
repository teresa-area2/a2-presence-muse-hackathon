import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/settle.mjs';
test('exports the settlement API and handles an empty trip', () => {
  assert.deepEqual(Object.keys(api), ['settleTrip']);
  assert.deepEqual(api.settleTrip({people: ['ben', 'alice'], expenses: []}), {
    balances: [{person: 'alice', balanceCents: 0}, {person: 'ben', balanceCents: 0}],
    transfers: []
  });
});
