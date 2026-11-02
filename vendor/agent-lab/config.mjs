import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {accessSync,existsSync,constants} from 'node:fs';
const envFile=fileURLToPath(new URL('./.env',import.meta.url));
if(existsSync(envFile)){if(typeof process.loadEnvFile!=='function')throw Error('Node.js 22 or newer is required to load .env');process.loadEnvFile(envFile);}
/** Resolve only executable files; missing optional hosts do not prevent startup. */
export function resolveExecutable(value,{env=process.env,access=accessSync}={}){
 if(!value)return null;
 const candidates=value.includes('/')?[path.resolve(value)]:(env.PATH??'').split(path.delimiter).filter(Boolean).map(dir=>path.resolve(dir,value));
 for(const candidate of candidates)try{access(candidate,constants.X_OK);return candidate;}catch{}
 return null;
}
export function createLabConfig(env=process.env,{resolve=resolveExecutable}={}){
 const executable=(key,fallback)=>resolve(env[key]||fallback,{env});
 const runtimeRoot=env.A2_OPEN_PRESENCE_LOCAL?path.resolve(env.A2_OPEN_PRESENCE_LOCAL):null;
 return Object.freeze({python:executable('A2_LAB_PYTHON','python3'),codex:executable('A2_LAB_CODEX','codex'),claude:executable('A2_LAB_CLAUDE','claude'),muse:executable('A2_LAB_MUSE','muse'),runtimeRoot,probe:env.A2_DEMO_PROBE?path.resolve(env.A2_DEMO_PROBE):runtimeRoot?path.join(runtimeRoot,'presence-pa'):null,state:env.A2_DEMO_STATE?path.resolve(env.A2_DEMO_STATE):runtimeRoot?path.join(runtimeRoot,'.a2/live/selected.json'):null,baselineOnly:env.A2_LAB_BASELINE_ONLY==='1',comparisonEvaluation:env.A2_LAB_EVALUATOR_ENABLED==='1'});
}
export const labConfig=createLabConfig();
