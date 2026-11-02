// Supplemental examples of the fixed public Save-conflicts contract.
// Frozen by the coordinator before candidate dispatch; not agent input.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const workspace=process.env.A2_CANDIDATE_WORKSPACE;
if(typeof workspace!=='string'||!path.isAbsolute(workspace))throw Error('candidate_workspace_required');
const {saveEdit}=await import(pathToFileURL(path.join(workspace,'src/save.mjs')).href);
const conflict=()=>Object.assign(new Error('revision conflict'),{code:'CONFLICT'});

test('ordinary success returns the complete saved record with one original-revision write and no fetch',async()=>{
 const saved={revision:12,fields:{title:'Saved'},serverStamp:'canonical'},calls=[];
 const result=await saveEdit({save:async(...args)=>{calls.push(args);return saved;},get:async()=>assert.fail('ordinary save must not fetch')},'task-7',{title:'Draft'},11);
 assert.deepEqual(result,saved);assert.deepEqual(calls,[['task-7',{title:'Draft'},11]]);
});

test('a non-CONFLICT failure propagates the original error without fetch or extra writes',async()=>{
 const error=Object.assign(new Error('service unavailable'),{code:'UNAVAILABLE'}),calls=[];
 await assert.rejects(saveEdit({save:async(...args)=>{calls.push(args);throw error;},get:async()=>assert.fail('non-conflict failure must not fetch')},'task-7',{title:'Draft'},11),e=>e===error);
 assert.deepEqual(calls,[['task-7',{title:'Draft'},11]]);
});

test('a failed conflict fetch propagates its error without any retry write',async()=>{
 const error=new Error('fetch unavailable'),calls=[];
 await assert.rejects(saveEdit({save:async(...args)=>{calls.push(['save',...args]);throw conflict();},get:async id=>{calls.push(['get',id]);throw error;}},'task-7',{title:'Draft'},11),e=>e===error);
 assert.deepEqual(calls,[['save','task-7',{title:'Draft'},11],['get','task-7']]);
});

test('a non-conflict retry failure propagates its error with no third write or second fetch',async()=>{
 const error=Object.assign(new Error('retry unavailable'),{code:'UNAVAILABLE'}),calls=[];let writes=0;
 await assert.rejects(saveEdit({save:async(id,patch,revision)=>{calls.push(['save',id,{...patch},revision]);if(++writes===1)throw conflict();throw error;},get:async id=>{calls.push(['get',id]);return{revision:20,fields:{title:'Remote',label:'retain'}};}},'task-7',{title:'Draft'},11),e=>e===error);
 assert.deepEqual(calls,[['save','task-7',{title:'Draft'},11],['get','task-7'],['save','task-7',{title:'Draft',label:'retain'},20]]);
});

test('a second conflict is returned unchanged without a retry loop',async()=>{
 const error=conflict(),calls=[];
 await assert.rejects(saveEdit({save:async(id,patch,revision)=>{calls.push(['save',id,{...patch},revision]);throw error;},get:async id=>{calls.push(['get',id]);return{revision:20,fields:{label:'retain'}};}},'task-7',{title:'Draft'},11),e=>e===error);
 assert.deepEqual(calls,[['save','task-7',{title:'Draft'},11],['get','task-7'],['save','task-7',{label:'retain',title:'Draft'},20]]);
});

test('successful conflict retry keeps remote-only fields and draft precedence, fetched revision and returned record',async()=>{
 const calls=[],saved={revision:21,fields:{title:'Draft',label:'retain',note:''},serverStamp:'canonical'};let writes=0;
 const result=await saveEdit({save:async(id,patch,revision)=>{calls.push(['save',id,{...patch},revision]);if(++writes===1)throw conflict();return saved;},get:async id=>{calls.push(['get',id]);return{revision:20,fields:{title:'Remote',label:'retain',note:'Remote note'}};}},'task-7',{title:'Draft',note:''},11);
 assert.deepEqual(result,saved);assert.deepEqual(calls,[['save','task-7',{title:'Draft',note:''},11],['get','task-7'],['save','task-7',{title:'Draft',label:'retain',note:''},20]]);
});

test('successful conflict handling does not mutate caller draft or fetched server fields',async()=>{
 const draft=Object.freeze({title:'Draft'}),fields=Object.freeze({title:'Remote',label:'retain'}),current=Object.freeze({revision:20,fields});let writes=0;
 const result=await saveEdit({save:async(id,patch,revision)=>{if(++writes===1)throw conflict();return{revision:21,fields:patch};},get:async()=>current},'task-7',draft,11);
 assert.deepEqual(result,{revision:21,fields:{title:'Draft',label:'retain'}});assert.deepEqual(draft,{title:'Draft'});assert.deepEqual(current,{revision:20,fields:{title:'Remote',label:'retain'}});assert.equal(writes,2);
});

test('failed retry leaves caller draft and fetched server fields unchanged',async()=>{
 const draft=Object.freeze({title:'Draft'}),fields=Object.freeze({title:'Remote',label:'retain'}),error=new Error('retry failed');let writes=0,reads=0;
 await assert.rejects(saveEdit({save:async()=>{if(++writes===1)throw conflict();throw error;},get:async()=>{reads++;return{revision:20,fields};}},'task-7',draft,11),e=>e===error);
 assert.deepEqual(draft,{title:'Draft'});assert.deepEqual(fields,{title:'Remote',label:'retain'});assert.equal(writes,2);assert.equal(reads,1);
});
