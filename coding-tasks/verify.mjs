import {spawnSync} from 'node:child_process';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));let failures=0;
for(const task of manifest.tasks){const base=path.join(root,'tasks',task.id),project=path.join(base,'project'),reference=path.join(base,'reference'),check=[path.join(base,'checks','acceptance.test.mjs'),...(task.supplemental_acceptance?[path.join(root,task.supplemental_acceptance)]:[])];
 function run(target,dir){const env={...process.env,TASK_PROJECT_DIR:dir,A2_CANDIDATE_WORKSPACE:dir};delete env.NODE_TEST_CONTEXT;return spawnSync(process.execPath,['--test',...(Array.isArray(target)?target:[target])],{cwd:dir,env,encoding:'utf8',timeout:10000})}
 const smoke=run('test/smoke.test.mjs',project),publicStarter=run('test/behavior.test.mjs',project),publicReference=run(path.join(project,'test','behavior.test.mjs'),reference),starter=run(check,project),solved=run(check,reference);
 const ok=smoke.status===0&&publicStarter.status===1&&publicReference.status===0&&starter.status===1&&solved.status===0&&!starter.stdout.includes('ERR_MODULE_NOT_FOUND')&&!publicStarter.stdout.includes('ERR_MODULE_NOT_FOUND');
 console.log(`${task.id}: smoke ${smoke.status===0?'pass':'FAIL'}; public starter ${publicStarter.status===1?'expected fail':'FAIL'}; public reference ${publicReference.status===0?'pass':'FAIL'}; starter ${starter.status===1?'expected fail':'FAIL'}; reference ${solved.status===0?'pass':'FAIL'}`);if(!ok){failures++;console.error(smoke.stderr,publicStarter.stdout,publicReference.stdout,starter.stdout,solved.stdout,solved.stderr)}
}
if(failures)process.exitCode=1;
