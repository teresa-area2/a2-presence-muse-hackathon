import test from 'node:test'; import assert from 'node:assert/strict'; import * as api from '../src/save.mjs';
test('module exports its public API',()=>assert.equal(Object.keys(api).length,1));
