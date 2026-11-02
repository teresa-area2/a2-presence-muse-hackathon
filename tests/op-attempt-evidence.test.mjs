import test from 'node:test';
import assert from 'node:assert/strict';
import {projectEvidence} from '../src/evidence-projection.mjs';

const row=(extra={})=>({kind:'http',start_wall_ms:1700000000000,end_wall_ms:1700000002000,duration_ms:2000,http_status:429,outcome:'backoff',retry_after_ms:90000,cooldown_ms:90000,...extra});
const projected=(rows,omitted=0)=>projectEvidence({textbox:{attempt_history:rows,attempt_history_omitted:omitted}}).textbox;

test('safe HTTP attempt metadata survives evidence projection without payloads or headers',()=>{
 const input=row({body:'PRIVATE',headers:{authorization:'PRIVATE'},capsule:'PRIVATE',sessionID:'PRIVATE'}),out=projected([input]);
 assert.deepEqual(out.attempt_history,[row()]);assert.equal(out.attempt_history_omitted,0);assert.ok(!JSON.stringify(out).includes('PRIVATE'));
});

test('local admission cannot acquire injected remote HTTP evidence',()=>{
 const local=row({kind:'local_backoff',end_wall_ms:1700000002000,http_status:200,outcome:'backoff'}),out=projected([local]);
 assert.deepEqual(out.attempt_history,[row({kind:'local_backoff',end_wall_ms:null,duration_ms:null,http_status:null,retry_after_ms:null})]);
});

test('attempt evidence is bounded, reports omissions and leaves legacy history unknown',()=>{
 const out=projected(Array.from({length:70},(_,i)=>row({start_wall_ms:1700000000000+i})),3);
 assert.equal(out.attempt_history.length,64);assert.equal(out.attempt_history[0].start_wall_ms,1700000000006);assert.equal(out.attempt_history_omitted,9);
 const legacy=projectEvidence({textbox:{status:'ready'}}).textbox;assert.equal(legacy.attempt_history,null);assert.equal(legacy.attempt_history_omitted,null);
 assert.deepEqual(projected([]).attempt_history,[]);
});

test('invalid rows and scalar metadata fail closed without corrupting valid observations',()=>{
 const out=projected([row({kind:'PRIVATE'}),row({outcome:'PRIVATE'}),row({http_status:'PRIVATE',duration_ms:Infinity,start_wall_ms:'PRIVATE',end_wall_ms:-1,retry_after_ms:NaN,cooldown_ms:-1})]);
 assert.deepEqual(out.attempt_history,[row({http_status:null,duration_ms:null,start_wall_ms:null,end_wall_ms:null,retry_after_ms:null,cooldown_ms:null})]);assert.equal(out.attempt_history_omitted,2);assert.ok(!JSON.stringify(out).includes('PRIVATE'));
 assert.equal(projected([row()],Number.MAX_SAFE_INTEGER+1).attempt_history_omitted,null);
});

test('backward wall adjustment retains independent monotonic duration and copies rows',()=>{
 const input=[row({end_wall_ms:1699999999000})],out=projected(input);assert.equal(out.attempt_history[0].duration_ms,2000);assert.equal(out.attempt_history[0].end_wall_ms,1699999999000);out.attempt_history[0].duration_ms=1;assert.equal(input[0].duration_ms,2000);
});
