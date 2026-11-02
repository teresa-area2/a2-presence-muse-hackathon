// Additional compatibility checks identified by source review.
// Separate from the earlier frozen eight-case study; accepts reviewed functions only.
import assert from 'node:assert/strict';
import {gradeSaveContract} from './save-contract-quality.mjs';
export async function gradeSaveCompatibility(saveEdit){
 const base=await gradeSaveContract(saveEdit),cases=[...base.cases];
 for(const mode of ['fetched_date','fetched_cycle','non_conflict_null']){
  let writes=0,reads=0,failure=null;const stamp=new Date('2026-10-01T00:00:00Z'),cycle={};cycle.self=cycle;
  const draft={title:'Pending',meta:{tags:['original']},flags:[true]},before=structuredClone(draft);
  try{
   const run=()=>saveEdit({save:async(_id,patch)=>{assert.ok(++writes<=2);if(mode==='non_conflict_null')throw null;if(writes===1)throw{code:'CONFLICT'};if(mode==='fetched_date'){assert.ok(patch.stamp instanceof Date);assert.equal(patch.stamp.getTime(),stamp.getTime());}else{assert.equal(patch.cycle,cycle);assert.equal(patch.cycle.self,cycle);}return true;},get:async()=>{assert.equal(++reads,1);return{revision:20,fields:mode==='fetched_date'?{stamp}:{cycle}};}},'task-7',draft,11);
   if(mode==='non_conflict_null')await assert.rejects(run,e=>e===null);else assert.equal(await run(),true);
   assert.deepEqual(draft,before);assert.equal(writes,mode==='non_conflict_null'?1:2);assert.equal(reads,mode==='non_conflict_null'?0:1);
  }catch(error){failure=typeof error?.name==='string'?error.name:'failure';}
  cases.push({id:mode,status:failure?'fail':'pass',error_type:failure,writes,reads});
 }
 return{passed:cases.filter(c=>c.status==='pass').length,total:cases.length,cases};
}
