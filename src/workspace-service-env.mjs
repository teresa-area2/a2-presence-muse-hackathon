import {terminalEnvironment}from'./terminal-env.mjs';
// Backend configuration paths/mode only. Credentials never enter the manifest
// or model-process environment; terminalEnvironment scrubs these again for Muse.
export function workspaceServiceEnvironment(source,instance){
 const env=terminalEnvironment(source);for(const key of ['A2_SETUP_CONFIG','A2_AGENT_LAB_ROOT','A2_OPEN_PRESENCE_LOCAL','A2_LAB_PYTHON','A2_LAB_MUSE','A2_MUSE_TASK_PROFILE','A2_MUSE_PROJECT_WORKSPACES','A2_MUSE_PRESENCE_SOURCE','A2_MUSE_OP_LIVE','A2_MUSE_CAPTURE_AUTHORIZED','A2_MUSE_OP_CONFIG','A2_OP_CLIENT_MODULE']){const value=source[key];if(value===undefined)continue;if(typeof value!=='string'||!value||/[\x00-\x1f\x7f]/.test(value))throw Error('workspace_environment_invalid');env[key]=value;}
 if(env.A2_MUSE_PRESENCE_SOURCE&&!['desktop','textbox'].includes(env.A2_MUSE_PRESENCE_SOURCE)||env.A2_MUSE_OP_LIVE&&!['0','1'].includes(env.A2_MUSE_OP_LIVE)||env.A2_MUSE_CAPTURE_AUTHORIZED&&!['0','1'].includes(env.A2_MUSE_CAPTURE_AUTHORIZED))throw Error('workspace_environment_invalid');env.A2_WORKSPACE_INSTANCE=instance;return env;
}
