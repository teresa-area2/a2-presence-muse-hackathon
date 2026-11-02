import {installNativeApprovalAdapter} from '../../src/native-approval-adapter.mjs';
// Actual vendored JSONL client and owned pair; no child process/model/tool executes.
import {EventEmitter} from 'node:events';import {PassThrough,Writable} from 'node:stream';
import {MuseMsp} from '../../vendor/agent-lab/core/muse-msp.mjs';import {StructuredPair} from '../../src/structured-pair.mjs';
export function approvalNativeFixture({delayDecisions=false}={}){
 let sequence=0;const frames=[],children={},waiting=[];
 const sessions=Object.fromEntries(['without','with'].map(name=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;child.signalCode=null;let client;
  child.stdin=new Writable({write(chunk,_encoding,done){const frame=JSON.parse(String(chunk));frames.push({arm:name,...frame});if(frame.method==='approval/decide'){const ack=()=>client.consume(JSON.stringify({jsonrpc:'2.0',id:frame.id,result:{status:'accepted',approvalId:frame.params.approvalId}})+'\n');if(delayDecisions)waiting.push(ack);else ack();}if(frame.method==='turn/interrupt')client.consume(JSON.stringify({jsonrpc:'2.0',id:frame.id,result:{status:'accepted',commandId:frame.params.commandId,turnId:frame.params.turnId}})+'\n');done();}});
  client=installNativeApprovalAdapter(new MuseMsp({child}));client.sessionId='session-'+name;client.stop=async()=>{client.closed=true;client.stopping=true;};children[name]=child;
  return[name,{client,ledger:{bindTurn(){},accept(){return[];}},usage:{observe(){},snapshot(){return{status:'not_observed'};}}}];
 }));
 const pair=new StructuredPair({sessions,makeId:()=>`command-${++sequence}`,confirmExit:async()=>true});
 for(const name of ['without','with']){const arm=pair.arms[name],client=sessions[name].client;arm.prepare();arm.bindTurn('turn-'+name);}
 const notify=(arm,method,params)=>sessions[arm].client.consume(JSON.stringify({jsonrpc:'2.0',method,params})+'\n');
 const request=(arm,subject,extra={})=>{const p={sessionId:sessions[arm].client.sessionId,turnId:sessions[arm].client.activeTurnId,approvalId:'approval-'+arm,currentRequirementId:{approvalId:'approval-'+arm,sourceIndex:0},subject,availableChoices:[{choiceId:'once',label:'Allow once',decision:'approved',scope:'once'},{choiceId:'deny',label:'Reject',decision:'denied',scope:'once'},{choiceId:'session',label:'Allow for session',decision:'approvedForSession',scope:'session'}],...extra};sessions[arm].client.consume(JSON.stringify({jsonrpc:'2.0',id:++sequence,method:'approval/request',params:p})+'\n');return p;};
 return{pair,sessions,frames,children,request,notify,releaseDecision(){waiting.shift()?.();},complete(arm,terminal='cancelled'){notify(arm,'turn/completed',{sessionId:sessions[arm].client.sessionId,turnId:sessions[arm].client.activeTurnId,terminal});}};
}
