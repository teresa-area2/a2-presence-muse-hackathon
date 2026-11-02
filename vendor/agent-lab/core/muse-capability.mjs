// Reviewed Presence hook capabilities. Both PreLLMCall (guidance injection)
// and PostLLMCall (observation-only response correlation) are disabled in
// baseline and enabled only from this workspace's local approval result.
// Other inherited execution stays refused.
export const MUSE_BOUNDARY_CAPABILITY='plugin:area2-presence-boundary:hook:pre-llm';
export const MUSE_POST_CAPABILITY='plugin:area2-presence-boundary:hook:post-llm';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function checkedCapability(value){
 if(!object(value)||Object.keys(value).some(k=>!['enabled','trusted_definition_hash'].includes(k))||typeof value.enabled!=='boolean'||!/^sha256:[a-f0-9]{64}$/.test(value.trusted_definition_hash??''))throw Error('Invalid reviewed Muse hook capability');
 return {enabled:value.enabled,trusted_definition_hash:value.trusted_definition_hash};
}
const KNOWN_CAPABILITIES=new Set([MUSE_BOUNDARY_CAPABILITY,MUSE_POST_CAPABILITY]);
export function reviewedMuseSettings(config){
 if(!object(config)||Object.keys(config).some(k=>!['schema_version','tui','runtime_capabilities'].includes(k)))throw Error('Muse has inherited configuration beyond reviewed interface/capability settings.');
 if(config.runtime_capabilities===undefined)return null;
 const capabilities=config.runtime_capabilities;
 if(!object(capabilities)||Object.keys(capabilities).some(k=>!KNOWN_CAPABILITIES.has(k)))throw Error('Muse has unreviewed inherited runtime capabilities.');
 return capabilities[MUSE_BOUNDARY_CAPABILITY]===undefined?null:checkedCapability(capabilities[MUSE_BOUNDARY_CAPABILITY]);
}
export function reviewedMusePostSettings(config){
 if(!object(config)||Object.keys(config).some(k=>!['schema_version','tui','runtime_capabilities'].includes(k)))throw Error('Muse has inherited configuration beyond reviewed interface/capability settings.');
 if(config.runtime_capabilities===undefined)return null;
 const capabilities=config.runtime_capabilities;
 if(!object(capabilities)||Object.keys(capabilities).some(k=>!KNOWN_CAPABILITIES.has(k)))throw Error('Muse has unreviewed inherited runtime capabilities.');
 return capabilities[MUSE_POST_CAPABILITY]===undefined?null:checkedCapability(capabilities[MUSE_POST_CAPABILITY]);
}
// Combined review for both Presence hook capabilities. Baseline callers must
// explicitly disable both, including inherited settings.
export function reviewedMuseHookSettings(config){
 if(!object(config)||Object.keys(config).some(k=>!['schema_version','tui','runtime_capabilities'].includes(k)))throw Error('Muse has inherited configuration beyond reviewed interface/capability settings.');
 if(config.runtime_capabilities===undefined)return {pre:null,post:null};
 const capabilities=config.runtime_capabilities;
 if(!object(capabilities)||Object.keys(capabilities).some(k=>!KNOWN_CAPABILITIES.has(k)))throw Error('Muse has unreviewed inherited runtime capabilities.');
 return {
  pre:capabilities[MUSE_BOUNDARY_CAPABILITY]===undefined?null:checkedCapability(capabilities[MUSE_BOUNDARY_CAPABILITY]),
  post:capabilities[MUSE_POST_CAPABILITY]===undefined?null:checkedCapability(capabilities[MUSE_POST_CAPABILITY]),
 };
}
export function capabilityOverride(value,enabled){
 const capability=checkedCapability(value);
 return 'runtime_capabilities.'+MUSE_BOUNDARY_CAPABILITY+'='+JSON.stringify({...capability,enabled});
}
export function postCapabilityOverride(value,enabled){
 const capability=checkedCapability(value);
 return 'runtime_capabilities.'+MUSE_POST_CAPABILITY+'='+JSON.stringify({...capability,enabled});
}
// Ordered overrides for both hooks. Baseline passes enabled=false for both;
// adapted runs pass enabled=true for both after private approval.
export function hookCapabilityOverrides({pre=null,post=null}={},enabled=false){
 const args=[];
 if(pre!==null&&pre!==undefined)args.push(capabilityOverride(pre,enabled));
 if(post!==null&&post!==undefined)args.push(postCapabilityOverride(post,enabled));
 return args;
}
