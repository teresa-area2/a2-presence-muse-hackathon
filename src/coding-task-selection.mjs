import {CODING_TASKS,DEFAULT_CODING_TASK,requireCodingTaskId,requireWorkspaceTaskId,FREE_CODING_TASK} from './coding-task-catalog.mjs';
export const CODING_TASK_FIRST_MESSAGE='Please read TASK.md and CONTRACT.md, propose a short plan, and wait for my response before making changes.';
// Startup-only authority: the browser selects a closed ID, never a path or plan.
export function codingTaskSelection(registry){
 if(registry===null)return null;
 if(!registry||registry.defaultTask!==DEFAULT_CODING_TASK||!Array.isArray(registry.entries)||registry.entries.length!==CODING_TASKS.length||!/^[0-9a-f]{40}$/.test(registry.fixtureCommit)||typeof registry.fixtureVersion!=='string'||!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/.test(registry.fixtureVersion))throw Error('coding_task_registry_invalid');
 const entries=new Map();
 for(const spec of CODING_TASKS){
  const found=registry.entries.filter(e=>e?.id===spec.id);if(found.length!==1)throw Error('coding_task_registry_invalid');
  const e=found[0],p=e.plan,m=e.metadata;
  if(!p||p.taskId!==spec.taskId||!/^[0-9a-f]{40}$/.test(p.originalCommit)||!/^[0-9a-f]{64}$/.test(p.expectedPlanHash)||typeof e.profilePath!=='string'||!e.profilePath.startsWith('/')||/[\x00-\x1f\x7f]/.test(e.profilePath)||!m||m.task_id!==spec.taskId||m.task_profile_id!==spec.id||m.fixture_commit!==registry.fixtureCommit||m.fixture_version!==registry.fixtureVersion||m.source_commit!==p.originalCommit||m.verification_plan_hash!==p.expectedPlanHash)throw Error('coding_task_registry_invalid');
  entries.set(spec.id,Object.freeze({...e,...spec,metadata:Object.freeze({task_id:spec.taskId,task_profile_id:spec.id,fixture_commit:registry.fixtureCommit,fixture_version:registry.fixtureVersion,source_commit:p.originalCommit,verification_plan_hash:p.expectedPlanHash}),presentation:Object.freeze({taskBrief:Object.freeze({title:'Coding task: '+spec.title,description:spec.description,nextSteps:Object.freeze(['Ask both agents for a plan, then review before implementation.','Approve commands inside each pane; request a revision when ready.'])}),taskPrompt:CODING_TASK_FIRST_MESSAGE})}));
 }
 if(registry.freeTask!==undefined){
  const e=registry.freeTask,p=e?.plan,m=e?.metadata;
  if(e?.id!==FREE_CODING_TASK.id||p?.taskId!==FREE_CODING_TASK.taskId||p.verificationMode!=='none'||p.expectedPlanHash!==null||!Array.isArray(p.ownTests)||p.ownTests.length||!p.trustedFiles||Object.keys(p.trustedFiles).length||!/^[0-9a-f]{40}$/.test(p.originalCommit)||m?.task_id!==FREE_CODING_TASK.taskId||m?.task_profile_id!==FREE_CODING_TASK.id||m?.fixture_commit!==registry.fixtureCommit||m?.fixture_version!==registry.fixtureVersion||m?.source_commit!==p.originalCommit||m?.verification_plan_hash!==null)throw Error('coding_task_registry_invalid');
  entries.set(FREE_CODING_TASK.id,Object.freeze({...e,...FREE_CODING_TASK,metadata:Object.freeze({task_id:FREE_CODING_TASK.taskId,task_profile_id:FREE_CODING_TASK.id,fixture_commit:registry.fixtureCommit,fixture_version:registry.fixtureVersion,source_commit:p.originalCommit,verification_plan_hash:null}),presentation:Object.freeze({taskBrief:Object.freeze({title:'Your task · clean workspace',description:FREE_CODING_TASK.description,nextSteps:Object.freeze(['Describe your goal, then discuss a plan before implementation.'])}),taskPrompt:''})}));
 }
 const publicTasks=[...CODING_TASKS,...(registry.freeTask?[FREE_CODING_TASK]:[])].map(({id,title,description})=>Object.freeze({id,title,description}));
 return Object.freeze({config:Object.freeze({tasks:publicTasks,default_task:DEFAULT_CODING_TASK}),select(value){const id=requireWorkspaceTaskId(value);if(!entries.has(id))throw Error('coding_task_invalid');return entries.get(id);}});
}
