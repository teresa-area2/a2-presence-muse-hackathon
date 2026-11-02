// Only host settings required for the user's locally authenticated Muse CLI.
// In particular, no provider API keys, tokens, cloud credentials, or unrelated
// agent settings are inherited by the model-controlled terminal process.
import path from 'node:path';
const ALLOWED=['HOME','PATH','TMPDIR','LANG','LC_ALL','LC_CTYPE','USER','LOGNAME','SHELL','XDG_CONFIG_HOME'];
export function terminalEnvironment(source=process.env){
 if(!source||typeof source!=='object')throw Error('terminal_environment_invalid');
 const env={};for(const key of ALLOWED){const value=source[key];if(value===undefined)continue;if(typeof value!=='string'||value.includes('\0'))throw Error('terminal_environment_invalid');env[key]=value;}
 if(!env.HOME||!env.PATH||!path.isAbsolute(env.HOME)||['XDG_CONFIG_HOME','TMPDIR','SHELL'].some(k=>env[k]&&!path.isAbsolute(env[k])))throw Error('terminal_environment_invalid');
 env.MUSE_NO_AUTO_UPDATE='1';env.MUSE_CONTRIBUTOR_MODE='0';return env;
}
