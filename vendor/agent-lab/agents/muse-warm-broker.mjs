// One owned broker per adapted session. No PID files or detached processes.
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../host-adapters/muse_warm_broker.py',import.meta.url));
export async function startMuseWarmBroker({python,probe,state,spawnProcess=spawn}) {
  // macOS sockaddr_un is 104 bytes: the actual project paths are longer.
  const dir=await mkdtemp('/private/tmp/a2-muse-');
  const socket=path.join(dir,'s');
  let child, closePromise;
  async function stopOwned() {
    if(child?.pid && child.exitCode===null && child.signalCode===null) {
      child.stdin.end();
      await Promise.race([once(child,'exit').catch(()=>{}),new Promise(r=>setTimeout(r,3000))]);
      if(child.exitCode===null && child.signalCode===null) {
        try{process.kill(-child.pid,'SIGTERM');}catch{}
        await Promise.race([once(child,'exit').catch(()=>{}),new Promise(r=>setTimeout(r,3000))]);
      }
      if(child.exitCode===null && child.signalCode===null) {
        try{process.kill(-child.pid,'SIGKILL');}catch{}
        await Promise.race([once(child,'exit').catch(()=>{}),new Promise(r=>setTimeout(r,1000))]);
      }
      if(child.exitCode===null && child.signalCode===null) throw Error('broker_cleanup_failed');
    }
  }
  function close() {
    if(!closePromise)closePromise=(async()=>{await stopOwned();await rm(dir,{recursive:true,force:true});})();
    return closePromise;
  }
  try {
    child=spawnProcess(python,['-B',script,socket,probe,state],{stdio:['pipe','pipe','ignore'],detached:true});
    child.on('error',()=>{}); // startup error is observed by the readiness wait
    child.stdin.on('error',()=>{});
    await new Promise((resolve,reject)=>{
      let buffer='';
      const timer=setTimeout(()=>finish(Error('broker_start_timeout')),10000);
      const finish=error=>{clearTimeout(timer);child.stdout.off('data',data);child.off('error',fail);child.off('exit',exit);error?reject(error):resolve();};
      const fail=()=>finish(Error('broker_start_failed'));
      const exit=()=>finish(Error('broker_start_failed'));
      const data=chunk=>{buffer+=chunk;if(buffer.length>64)return fail();if(buffer.includes('\n'))buffer==='ready\n'?finish():fail();};
      child.stdout.on('data',data);child.once('error',fail);child.once('exit',exit);
    });
    return {socket,close,available:true};
  } catch {
    // Keep the private, absent endpoint bound into the hook so startup
    // failure follows the same ordinary fallback as a lost connection.
    await stopOwned();
    await rm(socket,{force:true});
    return {socket,close,available:false};
  }
}
