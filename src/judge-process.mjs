import {spawn} from 'node:child_process';

// Only Unix process groups are used; no broad process discovery or port kills.
const maxOutput=2*1024*1024;
const knownCodes=new Set(['E401','E403','E404','ETIMEDOUT','ENOTFOUND','ECONNREFUSED','ECONNRESET','EINTEGRITY','EACCES','ENOSPC','EAI_AGAIN']);
export async function runJudgeCommand({entry,args,cwd,environment,signal,timeoutMs=180000}){
 if(process.platform==='win32')return {status:'unsupported',cleanupSafe:true};
 if(signal?.aborted)return {status:'cancelled',cleanupSafe:true};
 return new Promise(resolve=>{
  let child,settled=false,closed=false,exitCode=null,stopping=null,timer,escalation,unconfirmed,poll,bytes=0,stderr='';
  const settle=result=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(escalation);clearTimeout(unconfirmed);clearInterval(poll);signal?.removeEventListener('abort',onAbort);resolve(result);};
  const kill=kind=>{if(!child?.pid)return;try{process.kill(-child.pid,kind);}catch(e){if(e.code!=='ESRCH')stopping='termination_unconfirmed';}};
  const stop=reason=>{if(stopping||settled)return;stopping=reason;kill('SIGTERM');escalation=setTimeout(()=>kill('SIGKILL'),250);unconfirmed=setTimeout(()=>settle({status:'termination_unconfirmed',cleanupSafe:false}),2500);};
  const onAbort=()=>stop('cancelled');
  const confirmed=()=>{
   if(!closed||settled)return;
   let gone=false;try{process.kill(-child.pid,0);}catch(e){if(e.code==='ESRCH')gone=true;else{stop('termination_unconfirmed');return;}}
   if(!gone){if(!stopping)stop('descendant_cleanup');return;}
   if(stopping){settle({status:stopping,cleanupSafe:stopping!=='termination_unconfirmed'});return;}
   if(exitCode===0){settle({status:'completed',cleanupSafe:true});return;}
   const found=stderr.match(/\b(E[A-Z0-9_]{2,40})\b/)?.[1];settle({status:'failed',code:knownCodes.has(found)?found.toLowerCase():'command_failed',cleanupSafe:true});
  };
  try{child=spawn(process.execPath,[entry,...args],{cwd,env:environment,detached:true,stdio:['ignore','pipe','pipe']});}catch{settle({status:'failed',code:'command_failed',cleanupSafe:true});return;}
  const consume=(chunk,isError)=>{bytes+=chunk.length;if(bytes>maxOutput){stop('output_limit');return;}if(isError)stderr+=chunk.toString('utf8');};
  child.stdout.on('data',chunk=>consume(chunk,false));child.stderr.on('data',chunk=>consume(chunk,true));
  child.once('error',()=>{if(!child.pid)settle({status:'failed',code:'command_failed',cleanupSafe:true});else stop('termination_unconfirmed');});
  child.once('close',code=>{closed=true;exitCode=code;confirmed();if(!settled)poll=setInterval(confirmed,25);});
  signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort();
  timer=setTimeout(()=>stop('timeout'),timeoutMs);
 });
}
