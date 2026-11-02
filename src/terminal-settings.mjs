// Muse may persist selected model/provider globally. The TUI fixes both with
// per-process flags, so allow only these known values while retaining Lab's
// strict review of all hook/capability settings and without editing the file.
import {readFileSync} from 'node:fs';
const MODELS=new Set(['muse-spark-1.3','muse-spark-1.3-contributor','muse-wonder-1.0']);
const EFFORTS=new Set(['none','minimal','low','medium','high','xhigh','max','ultra']);
export function projectHookSettings(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('global_muse_settings_unqualified');
 const out={...value};if(out.model!==undefined&&!MODELS.has(out.model))throw Error('global_muse_model_unqualified');if(out.provider!==undefined&&out.provider!=='meta')throw Error('global_muse_provider_unqualified');if(out.reasoning_effort!==undefined&&!EFFORTS.has(out.reasoning_effort))throw Error('global_muse_effort_unqualified');if(out.contributor_mode_enabled!==undefined&&out.contributor_mode_enabled!==false)throw Error('global_muse_contributor_unqualified');if(out.context!==undefined&&(!out.context||typeof out.context!=='object'||Array.isArray(out.context)||Object.keys(out.context).some(k=>!['foreign_personal_rules','foreign_personal_skills'].includes(k))||out.context.foreign_personal_rules!==false||out.context.foreign_personal_skills!==false))throw Error('global_muse_context_unqualified');delete out.model;delete out.provider;delete out.reasoning_effort;delete out.contributor_mode_enabled;delete out.context;return out;
}
export function readTerminalHookSettings(file,encoding='utf8'){
 return JSON.stringify(projectHookSettings(JSON.parse(readFileSync(file,encoding))));
}

export function snapshotTerminalSettings(file){
 try{return readTerminalHookSettings(file,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
