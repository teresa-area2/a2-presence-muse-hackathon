import {labConfig} from '../config.mjs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdirSync,existsSync,readFileSync,lstatSync,realpathSync} from 'node:fs';
import {reviewedMuseHookSettings,checkedCapability,capabilityOverride,postCapabilityOverride} from '../core/muse-capability.mjs';
const boundaryHelper=fileURLToPath(new URL('../host-adapters/muse_boundary.py',import.meta.url));
export function prepareMuseBoundary({workspace,probe,state,binary,python=labConfig.python,brokerSocket=null}){
 const args=['--workspace',workspace,'--probe',probe,'--state',state,...(brokerSocket?['--broker-socket',brokerSocket]:[])];
 execFileSync(python,['-B',boundaryHelper,'prepare',...args],{timeout:10000,stdio:'pipe'});
 return JSON.parse(execFileSync(python,['-B',boundaryHelper,'install','--workspace',workspace,'--muse',binary],{timeout:100000,stdio:'pipe'}).toString());
}
export function museEnvironment(workspace,environment=process.env){
 const root=realpathSync(workspace),folder=path.join(root,'.presence'),data=path.join(folder,'muse-native-data'),native=path.join(data,'muse');
 for(const entry of [folder,data,native]){
  let prior;
  try{prior=lstatSync(entry);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(prior?.isSymbolicLink())throw Error('Unsafe Muse native data directory');
  if(!prior)mkdirSync(entry,{mode:0o700});
  const info=lstatSync(entry);
  const relative=path.relative(root,realpathSync(entry)),forbidden=entry===native?0o022:0o077;
  if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&forbidden)||(process.getuid&&info.uid!==process.getuid())||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Muse native data directory must be private and owned');
 }
 return {...environment,MUSE_NO_AUTO_UPDATE:'1',XDG_DATA_HOME:data};
}
export function museCommand({workspace,arm,home=os.homedir(),environment=process.env,exists=existsSync,read=readFileSync,binary=labConfig.muse,probe=labConfig.probe,state=labConfig.state,baselineOnly=labConfig.baselineOnly,prepareBoundary=prepareMuseBoundary,brokerSocket=null}){
 const settings=path.join(environment.XDG_CONFIG_HOME||path.join(home,'.config'),'muse/settings.json');
 const inherited=exists(settings)?reviewedMuseHookSettings(JSON.parse(read(settings,'utf8'))):{pre:null,post:null};
 if(!binary||!exists(binary))throw Error('Muse Code CLI is not installed.');
 const argv=[binary,'--workspace',workspace];
 const disable=()=>({enabled:false,trusted_definition_hash:'sha256:'+'0'.repeat(64)});
 let approval=null;
 if(arm==='with'&&!baselineOnly&&probe&&state){
  approval=prepareBoundary({workspace,probe,state,binary,brokerSocket});
  checkedCapability(approval?.capability_override);if(approval.capability_override.enabled!==true)throw Error('Workspace Muse hook was not approved');
  if(approval.post_capability_override!==undefined&&approval.post_capability_override!==null){checkedCapability(approval.post_capability_override);if(approval.post_capability_override.enabled!==true)throw Error('Workspace Muse post hook was not approved');}
 }
 // In warm mode the boundary owns the source read. A second required MCP
 // server could block ordinary fallback before the hook has a chance to run.
 if(arm==='with'&&!baselineOnly&&probe&&state&&!brokerSocket)argv.push('-c','mcp_servers.area2_presence='+JSON.stringify({transport:'stdio',command:probe,args:['--state',state,'mcp'],enabled:true,mode:'required'}));
 if(approval){
  argv.push('-c',capabilityOverride(approval.capability_override,true));
  // The PostLLMCall observation hook is approved alongside PreLLMCall from
  // the same private bundle. Older approvals without a post entry keep Pre
  // behavior unchanged; new approvals carry both.
  if(approval.post_capability_override)argv.push('-c',postCapabilityOverride(approval.post_capability_override,true));
  else argv.push('-c',postCapabilityOverride(inherited.post??disable(),false));
 }
 else {
  // Baseline explicitly disables BOTH Presence hook capabilities, including
  // inherited settings, so no ancestral approval can enable guidance or
  // response observation in the without arm.
  // When inherited values exist, disable those exact reviewed definitions.
  // When only one side was inherited, the other side is still disabled with a
  // placeholder definition so a foreign approval cannot slip through either path.
  argv.push('-c',capabilityOverride(inherited.pre??disable(),false));
  argv.push('-c',postCapabilityOverride(inherited.post??disable(),false));
 }
 return argv;
}
export const museInstructions=`
Presence native boundary mode: the adapter refreshes guidance automatically at PreLLMCall before every model generation, including the generation producing final handback. Use that latest eligible context; it supersedes intake and earlier controls. This automatic boundary read replaces manual probing when the hook context is present, including simple Q&A. Do not claim a manual MCP call when only the hook ran. If no automatic boundary context is present and get_presence_guidance is available, call it before visible text and again as the last substantive tool before delivery; the intake read never substitutes for the delivery read. If that tool is unavailable, use ordinary behavior. Verify every requested technical point against the inspected code, including validation, actual costs, assumptions, examples and limitations. Compress wording, not coverage. Apply only eligible production/live coding-instructions.3 guidance with a valid nonfuture receipt and consumer adaptation eligibility; no consumer age cutoff. Unavailable or source-ineligible guidance means ordinary behavior and supersedes earlier controls. Correctness, user intent and approvals take precedence. Do not change the collector or packaging. Native terminal output is never held.
`;
