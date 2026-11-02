import test from 'node:test';import assert from 'node:assert/strict';
import{gradeSaveContract,referenceSaveEdit}from'./helpers/save-contract-quality.mjs';
test('the corrected fix protects nested caller data without restricting fetched-only values',async()=>{
 const result=await gradeSaveContract(referenceSaveEdit);assert.equal(result.passed,8);assert.equal(result.total,8);
});
test('the oracle catches direct aliasing even on ordinary success',async()=>{
 const bad=async(client,id,draft,revision)=>client.save(id,draft,revision);const result=await gradeSaveContract(bad);assert.equal(result.cases.find(c=>c.id==='success').status,'fail');
});
test('cloning the merged patch fails on fetched-only functions while preserving overwritten values',async()=>{
 const bad=async(client,id,draft,revision)=>{const pending=structuredClone(draft);try{return await client.save(id,structuredClone(pending),revision);}catch(error){if(error?.code!=='CONFLICT')throw error;const saved=await client.get(id);return client.save(id,structuredClone({...saved.fields,...pending}),saved.revision);}};
 const result=await gradeSaveContract(bad);assert.equal(result.passed,7);assert.equal(result.cases.find(c=>c.id==='fetched_function').error_type,'DataCloneError');assert.equal(result.cases.find(c=>c.id==='overridden_function').status,'pass');
});
test('cloning fetched fields before overlay also rejects values the caller would override',async()=>{
 const bad=async(client,id,draft,revision)=>{const pending=structuredClone(draft);try{return await client.save(id,structuredClone(pending),revision);}catch(error){if(error?.code!=='CONFLICT')throw error;const saved=await client.get(id);return client.save(id,{...structuredClone(saved.fields),...structuredClone(pending)},saved.revision);}};
 const result=await gradeSaveContract(bad);assert.equal(result.passed,6);for(const id of['fetched_function','overridden_function'])assert.equal(result.cases.find(c=>c.id===id).error_type,'DataCloneError');
});

test('the oracle catches a shallow array alias that corrupts the retry draft',async()=>{
 const bad=async(client,id,draft,revision)=>{const pending=structuredClone(draft);try{return await client.save(id,{...pending,meta:structuredClone(pending.meta)},revision);}catch(error){if(error?.code!=='CONFLICT')throw error;const saved=await client.get(id);return client.save(id,{...saved.fields,...structuredClone(pending)},saved.revision);}};
 const result=await gradeSaveContract(bad);assert.equal(result.cases.find(c=>c.id==='conflict').status,'fail');
});
test('the oracle catches retrying a second conflict',async()=>{
 const bad=async(client,id,draft,revision)=>{const pending=structuredClone(draft);try{return await client.save(id,structuredClone(pending),revision);}catch(error){if(error?.code!=='CONFLICT')throw error;for(;;){const saved=await client.get(id);try{return await client.save(id,{...saved.fields,...structuredClone(pending)},saved.revision);}catch(next){if(next?.code!=='CONFLICT')throw next;}}}};
 const result=await gradeSaveContract(bad);assert.equal(result.cases.find(c=>c.id==='retry_conflict').status,'fail');
});

import{gradeSaveCompatibility}from'./helpers/save-compatibility-quality.mjs';
test('scoped draft copies preserve fetched Dates and cycles and arbitrary non-conflict errors',async()=>{
 const result=await gradeSaveCompatibility(referenceSaveEdit);assert.equal(result.passed,11);assert.equal(result.total,11);
});
test('recursive JSON copying of unrelated fetched fields fails compatibility despite passing the earlier eight cases',async()=>{
 const clone=v=>v===null||typeof v!=='object'?v:Array.isArray(v)?v.map(clone):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)]));
 const bad=async(client,id,draft,revision)=>{const pending=clone(draft);try{return await client.save(id,clone(pending),revision);}catch(error){if(error?.code!=='CONFLICT')throw error;const saved=await client.get(id);return client.save(id,clone({...saved.fields,...pending}),saved.revision);}};
 assert.equal((await gradeSaveContract(bad)).passed,8);const result=await gradeSaveCompatibility(bad);for(const id of['fetched_date','fetched_cycle'])assert.equal(result.cases.find(c=>c.id===id).status,'fail');
});
