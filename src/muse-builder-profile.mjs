// Source-only development launch specification. This helper never dispatches a
// model, authorizes a run, or controls the comparison/observer model. The caller
// must retain isolated settings, enforce timeoutMs/maxAttempts and record usage.
import fs from 'node:fs';
import path from 'node:path';
const manifest=JSON.parse(fs.readFileSync(new URL('../dependencies.json',import.meta.url),'utf8'));
const model=manifest.muse?.builder_model;
if(model!=='muse-wonder-1.0')throw Error('muse_builder_model_unapproved');
export const MUSE_BUILDER_PROFILE=Object.freeze({provider:'meta',model,preset:'empty',contributorMode:'off',reasoningEffort:'high',maxModelSteps:2,timeoutMs:180000,maxAttempts:1});
export function museSourceBuilderLaunch({promptFile,outputSchema}={}){
 for(const value of [promptFile,outputSchema])if(typeof value!=='string'||!path.isAbsolute(value)||/[\x00-\x1f\x7f]/.test(value))throw Error('muse_builder_path_invalid');
 const p=MUSE_BUILDER_PROFILE;
 const args=Object.freeze(['exec','--json','--provider',p.provider,'--model',p.model,'--preset',p.preset,'--contributor-mode',p.contributorMode,'--reasoning-effort',p.reasoningEffort,'--max-model-steps',String(p.maxModelSteps),'--output-schema',outputSchema,'--prompt-file',promptFile,'--no-session-log','--no-foreign-personal-context','--disable-reminders','--disable-web-tools','--disable-request-user-input','--disable-shell','--disable-write','--approval-mode','on-request']);
 return Object.freeze({args,timeoutMs:p.timeoutMs,maxAttempts:p.maxAttempts,model:p.model});
}
