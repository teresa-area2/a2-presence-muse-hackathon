import test from 'node:test'; import assert from 'node:assert/strict'; import {pathToFileURL,fileURLToPath} from 'node:url'; import path from 'node:path';
const base=process.env.TASK_PROJECT_DIR??fileURLToPath(new URL('../project/',import.meta.url));const {saveEdit}=await import(pathToFileURL(path.resolve(base,'src/save.mjs')));
test('ordinary save uses the supplied revision and does not fetch',async()=>{const calls=[];const client={save:async(...x)=>{calls.push(x);return {revision:4}},get:async()=>assert.fail('unexpected fetch')};assert.deepEqual(await saveEdit(client,'t',{title:'New'},3),{revision:4});assert.deepEqual(calls,[['t',{title:'New'},3]])});
test('conflict preserves draft, merges server fields, and retries once',async()=>{const draft={title:'Mine'},calls=[];const client={save:async(...x)=>{calls.push(x);if(calls.length===1)throw Object.assign(new Error('conflict'),{code:'CONFLICT'});return {fields:x[1],revision:8}},get:async()=>({revision:7,fields:{title:'Theirs',label:'open'}})};assert.deepEqual(await saveEdit(client,'t',draft,2),{fields:{title:'Mine',label:'open'},revision:8});assert.deepEqual(draft,{title:'Mine'});assert.deepEqual(calls.map(x=>x[2]),[2,7])});
test('second conflict is surfaced without an unbounded retry',async()=>{let n=0;const e=Object.assign(new Error('conflict'),{code:'CONFLICT'});const client={save:async()=>{n++;throw e},get:async()=>({revision:2,fields:{}})};await assert.rejects(()=>saveEdit(client,'t',{title:'x'},1),x=>x===e);assert.equal(n,2)});
test('non-conflict error propagates without fetch or retry',async()=>{let n=0;const e=new Error('offline');await assert.rejects(()=>saveEdit({save:async()=>{n++;throw e},get:async()=>assert.fail()},'t',{},1),x=>x===e);assert.equal(n,1)});


test('a client-normalized successful request leaves the caller draft unchanged',async()=>{
 const draft={title:'Mine',note:''},calls=[],saved={revision:4,fields:{title:'Normalized',note:''},serverStamp:'canonical'};
 const client={save:async(id,patch,revision)=>{calls.push([id,{...patch},revision]);patch.title='Normalized';patch.requestOnly=true;return saved},get:async()=>assert.fail('successful save must not fetch')};
 assert.strictEqual(await saveEdit(client,'t',draft,3),saved);
 assert.deepEqual(draft,{title:'Mine',note:''});
 assert.deepEqual(calls,[['t',{title:'Mine',note:''},3]]);
});

test('client normalization before a non-CONFLICT failure cannot modify the caller draft',async()=>{
 const draft={title:'Mine',note:''},calls=[],error=Object.assign(new Error('offline'),{code:'UNAVAILABLE'});
 const client={save:async(id,patch,revision)=>{calls.push([id,{...patch},revision]);patch.title='Normalized';patch.requestOnly=true;throw error},get:async()=>assert.fail('non-conflict failure must not fetch')};
 await assert.rejects(()=>saveEdit(client,'t',draft,3),value=>value===error);
 assert.deepEqual(draft,{title:'Mine',note:''});
 assert.deepEqual(calls,[['t',{title:'Mine',note:''},3]]);
});

test('conflict retry preserves original pending fields even if the first request is normalized',async()=>{
 const draft={title:'Mine',note:''},calls=[],fields=Object.freeze({title:'Theirs',label:'open',note:'Remote'}),current=Object.freeze({revision:7,fields});
 const client={save:async(id,patch,revision)=>{
  calls.push(['save',id,{...patch},revision]);
  if(calls.length===1){patch.title='Normalized';patch.note='Normalized note';patch.requestOnly=true;throw Object.assign(new Error('conflict'),{code:'CONFLICT'})}
  return{revision:8,fields:{...patch},serverStamp:'canonical'};
 },get:async id=>{calls.push(['get',id]);return current}};
 assert.deepEqual(await saveEdit(client,'t',draft,3),{revision:8,fields:{title:'Mine',label:'open',note:''},serverStamp:'canonical'});
 assert.deepEqual(draft,{title:'Mine',note:''});
 assert.deepEqual(current,{revision:7,fields:{title:'Theirs',label:'open',note:'Remote'}});
 assert.deepEqual(calls,[['save','t',{title:'Mine',note:''},3],['get','t'],['save','t',{title:'Mine',label:'open',note:''},7]]);
});
