import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {RuntimeReader} from '../src/runtime-reader.mjs';

test('assessment exceptions resolve to fallback and later reads can recover',async()=>{
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.exitCode=0;child.signalCode=null;
 const assess=raw=>{if(raw?.bad)throw Error('assessment failed');return {eligible:raw?.eligible===true,controls:null,renderer:null,read_at:null,received_at:null,fallback_reason:raw?'source_ineligible':'not_production_live'};};
 const reader=new RuntimeReader({python:'/unused',probe:'/unused',state:'/unused',assess,spawnProcess:()=>child});
 const first=reader.read();child.stdout.write(JSON.stringify({id:1,result:{bad:true}})+'\n');
 const result=await Promise.race([first,new Promise(resolve=>setTimeout(()=>resolve('hung'),50))]);
 assert.notEqual(result,'hung');assert.equal(result.eligible,false);assert.equal(result.controls,null);assert.equal(result.fallback_reason,'assessment_unavailable');
 const second=reader.read();child.stdout.write(JSON.stringify({id:2,result:{eligible:true}})+'\n');assert.equal((await second).eligible,true);await reader.close();
});
test('malformed or ineligible assessment never exposes prior controls',async()=>{
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.exitCode=0;child.signalCode=null;
 let n=0;const reader=new RuntimeReader({python:'/unused',probe:'/unused',state:'/unused',spawnProcess:()=>child,assess:()=>++n===1?null:{eligible:false,controls:{response_extent:'terse'},fallback_reason:'source_ineligible'}});
 const first=reader.read(),also=reader.read();child.stdout.write(JSON.stringify({id:1,result:{}})+'\n');const [a,b]=await Promise.all([first,also]);assert.equal(a.eligible,false);assert.equal(a.fallback_reason,'assessment_unavailable');assert.equal(b.reads,1);
 const second=reader.read();child.stdout.write(JSON.stringify({id:2,result:{}})+'\n');const c=await second;assert.equal(c.eligible,false);assert.equal(c.controls,null);assert.equal(c.fallback_reason,'source_ineligible');await reader.close();
});
test('oversized transport frames fail closed without retaining or accepting later bytes',async()=>{
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.exitCode=0;child.signalCode=null;
 const assess=raw=>({eligible:raw?.eligible===true,controls:null,renderer:null,read_at:null,received_at:null,fallback_reason:raw?'source_ineligible':'not_production_live'});
 const reader=new RuntimeReader({python:'/unused',probe:'/unused',state:'/unused',assess,spawnProcess:()=>child});
 const first=reader.read();child.stdout.write('x'.repeat(200001));assert.equal((await first).eligible,false);assert.equal(reader.buffer,'');
 child.stdout.write(JSON.stringify({id:2,result:{eligible:true}})+'\n');assert.equal((await reader.read()).eligible,false);assert.equal(reader.buffer,'');assert.equal(reader.dead,true);await reader.close();
});
