import test from 'node:test';import assert from 'node:assert/strict';
import {CODING_QUALITY_GUARD,sharedCodingQuality} from '../src/coding-quality.mjs';
test('same stable correctness rule extends common instructions, preserving safety before retry',()=>{
 const universal='Keep all required technical points.';const left=sharedCodingQuality(universal),right=sharedCodingQuality(universal);
 assert.equal(left,right);assert.ok(left.startsWith(universal));assert.ok(left.includes(CODING_QUALITY_GUARD));assert.match(left,/semantic overlap BEFORE any automatic retry/);assert.match(left,/latest draft after awaiting remote/);assert.match(left,/overlapping different edits require explicit resolution/);
});
test('invalid shared quality input refuses rather than weakening correctness',()=>{for(const x of [null,{},'', ' ', 'x'.repeat(6001)])assert.throws(()=>sharedCodingQuality(x),/shared_quality_invalid/);});

test('standalone task quality follows the frozen contract without importing PROJECT-07 APIs or conflict semantics',()=>{
 const result=sharedCodingQuality('Respect the reviewed public task.',{legacySaveContract:false});
 assert.match(result,/fixed public contract/);assert.match(result,/actual test results/);
 for(const phrase of ['base, remote','semantic overlap','latest draft after awaiting remote','overlapping different edits require explicit resolution'])assert.ok(!result.includes(phrase),phrase);
 assert.equal(sharedCodingQuality('Same task',{legacySaveContract:false}),sharedCodingQuality('Same task',{legacySaveContract:false}));
 assert.throws(()=>sharedCodingQuality('Task',{legacySaveContract:'false'}),/shared_quality_invalid/);
});
