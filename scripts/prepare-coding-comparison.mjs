// Prepare exactly the reviewed public task bytes, with one local Git commit.
// No model, runtime, collector, dependency install, remote or server is invoked.
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {runGit} from '../src/git-ops.mjs';import {root} from '../src/components.mjs';import {freezeProjectPlan} from '../src/project-task.mjs';
const FILES=['resolve-conflict.mjs','tests/contract.test.mjs','AGENTS.md','README.md'];
export async function prepareCodingComparison({sourceRoot=root,localRoot=path.join(sourceRoot,'.local')}={}){
 if(!path.isAbsolute(sourceRoot)||!path.isAbsolute(localRoot))throw Error('coding_task_paths_invalid');
 await fs.mkdir(localRoot,{recursive:true,mode:0o700});const st=await fs.lstat(localRoot);if(!st.isDirectory()||st.isSymbolicLink())throw Error('coding_task_local_unsafe');
 const folder=await fs.mkdtemp(path.join(localRoot,'project07-source-'));
 // Read from the fixed allowlist only. The correct reference and private build
 // evidence are deliberately outside this allowlist and never enter either arm.
 for(const name of FILES){const file=path.join(sourceRoot,'examples/conflict-task-board',name),info=await fs.lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>128000)throw Error('coding_task_source_invalid');await fs.mkdir(path.dirname(path.join(folder,name)),{recursive:true});await fs.copyFile(file,path.join(folder,name));}
 const prompt=await fs.readFile(path.join(sourceRoot,'docs/tasks/PROJECT-07.md'),'utf8');await fs.writeFile(path.join(folder,'TASK.md'),prompt);
 await runGit(['init','--quiet','-b','main'],folder);
 await runGit(['add','--',...FILES,'TASK.md'],folder);
 await runGit(['-c','user.name=Area2 task preparation','-c','user.email=task@localhost','commit','--quiet','-m','Frozen conflict-safe task-board exercise baseline'],folder);
 const commit=String(await runGit(['rev-parse','HEAD'],folder)).trim();const profile=JSON.parse(await fs.readFile(path.join(sourceRoot,'task-profiles/conflict-task-board.json'),'utf8'));
 profile.repository={root:folder,commit};profile.task.prompt=prompt;
 const frozen=await freezeProjectPlan({profile});profile.verification.trusted.plan_hash=frozen.expectedPlanHash;
 const profilePath=path.join(localRoot,'project07-profile.json');await fs.writeFile(profilePath,JSON.stringify(profile,null,2)+'\n',{mode:0o600});
 return {task_id:'PROJECT-07',profile:profilePath,repository:folder,original_commit:commit,verification_plan_hash:frozen.expectedPlanHash,files:[...FILES,'TASK.md'],reference_included:false,model_dispatched:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))prepareCodingComparison().then(x=>console.log(JSON.stringify(x,null,2))).catch(()=>{console.error('Coding comparison preparation refused. No model or collector started.');process.exitCode=1;});
