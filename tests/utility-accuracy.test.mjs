import test from 'node:test';
import assert from 'node:assert/strict';
import {StructuredArm} from '../src/structured-arm.mjs';
import {projectEvidence} from '../src/evidence-projection.mjs';

test('evidence exports the actual arm lifecycle without losing known elapsed status',()=>{
 let now=0;
 const client={sessionId:'fixture-session',turnIds:new Set(),approvals:new Map()};
 const arm=new StructuredArm({client,ledger:{bindTurn(){},accept(){return[];}},usage:{observe(){}},now:()=>now,onFatal:reason=>assert.fail(reason)});
 const elapsed=()=>projectEvidence({arms:{with:{elapsed:arm.elapsed()}}}).arms.with.elapsed;
 assert.equal(elapsed().status,'not_started');
 assert.equal(elapsed().total_seconds,null);
 arm.prepare();arm.bindTurn('turn-one');now=1200;
 assert.equal(elapsed().status,'running');assert.equal(elapsed().total_seconds,1.2);
 arm.incoming({method:'turn/completed',params:{sessionId:client.sessionId,turnId:'turn-one',terminal:'completed'}});
 assert.equal(elapsed().status,'completed');assert.equal(elapsed().completed_turns,1);assert.equal(elapsed().total_seconds,1.2);
 now=2000;arm.prepare();arm.bindTurn('turn-two');now=2500;arm.close();
 assert.equal(elapsed().status,'partial');assert.equal(elapsed().incomplete_turns,1);assert.equal(elapsed().total_seconds,1.7);
});

test('elapsed projection preserves canonical historical statuses and refuses unknown statuses',()=>{
 for(const status of ['not_started','running','completed','partial','unavailable','unknown']){
  assert.equal(projectEvidence({arms:{with:{elapsed:{status}}}}).arms.with.elapsed.status,status);
 }
 assert.equal(projectEvidence({arms:{with:{elapsed:{status:'PRIVATE_INVALID'}}}}).arms.with.elapsed.status,'unknown');
});
