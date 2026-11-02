// Invoke the unchanged pinned Lab boundary installer under an empty, private
// setup-only config. The parent launcher first reviews real inherited settings
// and Lab validates the returned capability. This config contains no auth.
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {terminalEnvironment} from './terminal-env.mjs';
export function prepareTerminalBoundary({workspace,probe,state,binary,python,brokerSocket,labRoot}, {execute=execFileSync,environment=process.env}={}){
 if(![workspace,probe,state,binary,python,labRoot].every(x=>typeof x==='string'&&path.isAbsolute(x)))throw Error('boundary_configuration_invalid');
 const parent=path.join(workspace,'.presence'),info=fs.lstatSync(parent);if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)||(process.getuid&&info.uid!==process.getuid()))throw Error('boundary_workspace_unsafe');
 const config=path.join(parent,'terminal-setup-config');fs.mkdirSync(config,{mode:0o700});
 const env={...terminalEnvironment(environment),XDG_CONFIG_HOME:config};const script=path.join(labRoot,'host-adapters/muse_boundary.py');
 const args=['--workspace',workspace,'--probe',probe,'--state',state,...(brokerSocket?['--broker-socket',brokerSocket]:[])];
 execute(python,['-B',script,'prepare',...args],{env,timeout:10000,stdio:'pipe'});
 return JSON.parse(execute(python,['-B',script,'install','--workspace',workspace,'--muse',binary],{env,timeout:100000,stdio:'pipe'}).toString());
}
