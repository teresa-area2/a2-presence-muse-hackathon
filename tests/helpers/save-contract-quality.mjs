// Synthetic review oracle, separate from the frozen coding-task benchmark.
// Callers supply a reviewed function, never untrusted source text. No eval/I/O.
import assert from 'node:assert/strict';
export const SAVE_REVIEW_CONTRACT='Caller-owned draft, including nested JSON-compatible values, stays unchanged even if save mutates its patch before success or rejection. First success returns without fetching. Only CONFLICT triggers one get and at most one retry using fetched revision; original pending draft values win over fetched fields. Non-conflict and retry errors propagate. No new API or validation rules. Fetched fields have no JSON or cloneability restriction.';
export const SAVE_REVIEW_STARTER=`export async function saveEdit(client, id, draft, revision) {
  try { return await client.save(id, draft, revision); }
  catch (error) {
    if (error?.code !== 'CONFLICT') throw error;
    const saved = await client.get(id);
    return client.save(id, { ...saved.fields, ...draft }, saved.revision);
  }
}`;
export async function referenceSaveEdit(client,id,draft,revision){
 const pending=structuredClone(draft);
 try{return await client.save(id,structuredClone(pending),revision);}
 catch(error){if(error?.code!=='CONFLICT')throw error;const remote=await client.get(id);return client.save(id,{...remote.fields,...structuredClone(pending)},remote.revision);}
}
const modes=['success','non_conflict','conflict','retry_failure','retry_conflict','fetch_failure','fetched_function','overridden_function'];
export async function gradeSaveContract(saveEdit){
 if(typeof saveEdit!=='function')throw Error('quality_candidate_invalid');
 const cases=[];
 for(const mode of modes){
  const draft={title:' Pending ',meta:{tags:['original']},flags:[true,false]},original=structuredClone(draft),error=Object.assign(Error('fixture failure'),mode==='retry_conflict'?{code:'CONFLICT'}:{}),extension=()=>42,savedRecord={revision:21,canonical:true};
  let writes=0,reads=0;const received=[];
  const remoteFields=mode==='fetched_function'?{title:'remote',label:'retain',extension}:mode==='overridden_function'?{title:extension,label:'retain'}:{title:'remote',label:'retain'};
  const client={async save(id,patch,revision){
   writes++;assert.ok(writes<=2,'at most one retry');assert.equal(id,'task-7');received.push({revision,title:patch.title,tags:[...patch.meta.tags],label:patch.label});
   if(writes===2){assert.equal(revision,20);assert.equal(patch.title,original.title);assert.equal(patch.label,'retain');assert.deepEqual(patch.meta.tags,original.meta.tags);assert.deepEqual(patch.flags,original.flags);if(mode==='fetched_function')assert.equal(patch.extension,extension);}
   patch.title='normalized';patch.meta.tags.push('normalized');patch.flags[0]=false;
   if(writes===1){if(mode==='non_conflict')throw error;if(mode!=='success')throw Object.assign(Error('fixture conflict'),{code:'CONFLICT'});}
   if(mode==='retry_failure'||mode==='retry_conflict')throw error;return savedRecord;
  },async get(id){reads++;assert.ok(reads<=1,'at most one fetch');assert.equal(id,'task-7');if(mode==='fetch_failure')throw error;return{revision:20,fields:remoteFields};}};
  let failure=null;
  try{
   if(['non_conflict','retry_failure','retry_conflict','fetch_failure'].includes(mode))await assert.rejects(saveEdit(client,'task-7',draft,11),e=>e===error);
   else assert.equal(await saveEdit(client,'task-7',draft,11),savedRecord);
   assert.deepEqual(draft,original);assert.equal(writes,['success','non_conflict','fetch_failure'].includes(mode)?1:2);assert.equal(reads,['success','non_conflict'].includes(mode)?0:1);assert.equal(received[0].revision,11);
  }catch(e){failure=typeof e?.name==='string'&&/^[A-Za-z]{1,50}$/.test(e.name)?e.name:'failure';}
  cases.push({id:mode,status:failure?'fail':'pass',error_type:failure,writes,reads});
 }
 return{passed:cases.filter(c=>c.status==='pass').length,total:cases.length,cases};
}
