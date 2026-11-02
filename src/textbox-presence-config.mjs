import fs from 'node:fs/promises';import {sha256,readDependencyBundle} from './dependency-bundle.mjs';
import path from'node:path';import os from'node:os';import {pathToFileURL}from'node:url';import {loadPrivateOpConfig,createOpenPresenceClient}from'./op-service-client.mjs';import {TextboxPresence}from'./textbox-presence.mjs';
export function textboxConfigPath(environment=process.env){const file=environment.A2_MUSE_OP_CONFIG||path.join(os.homedir(),'.config/area2/muse-hackathon-presence.json');if(!path.isAbsolute(file))throw Error('op_config_location_invalid');return file;}
// Invoked explicitly by the setup check or a future opt-in textbox launcher.
// No Auth/capture request occurs during loading or construction.
export async function loadTextboxPresence({repoRoot,environment=process.env,resolveCodingInstructions=null,fetcher=fetch,now=Date.now}={}){
 const config=await loadPrivateOpConfig(textboxConfigPath(environment),{repoRoot});
 if(!resolveCodingInstructions)resolveCodingInstructions=await loadCodingInstructions({repoRoot,environment});
 if(typeof resolveCodingInstructions!=='function')throw Error('op_validator_module_invalid');
 return new TextboxPresence({client:createOpenPresenceClient({...config,resolveCodingInstructions,fetcher,now}),now});
}

export async function loadCodingInstructions({repoRoot,environment=process.env}={}){
 const dependencies=JSON.parse(await fs.readFile(path.join(repoRoot,'dependencies.json'),'utf8')),spec=dependencies.capsule_validator;let entry=environment.A2_OP_CLIENT_MODULE;
 if(entry!==undefined){if(typeof entry!=='string'||!path.isAbsolute(entry))throw Error('op_validator_module_required');const st=await fs.lstat(entry);if(st.isSymbolicLink()||!st.isFile()||st.size>1024*1024)throw Error('op_validator_module_invalid');if(sha256(await fs.readFile(entry))!==spec.sha256)throw Error('op_validator_digest_mismatch');}
 else{const bundle=await readDependencyBundle({repoRoot,id:'capsule-validator',manifestSha256:spec.bundle_manifest_sha256,required:true});if(bundle.manifest.sources?.original_artifact_sha256!==spec.sha256)throw Error('op_validator_digest_mismatch');entry=bundle.entry;}
 const module=await import(pathToFileURL(entry).href);if(typeof module.resolveCodingInstructions!=='function')throw Error('op_validator_module_invalid');return module.resolveCodingInstructions;
}
