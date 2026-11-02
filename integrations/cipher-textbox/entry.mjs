// Existing multiline composer, official Cipher hook. No custom sensing.
import React,{useEffect}from'react';
import{createRoot}from'react-dom/client';
import{Area2Provider,useCipherCapture}from'@area2-ai/a2-cipher-react';
import{bindDesktopCipher,bindDualDesktopCipher,createCipherClipDriver}from'../../web/cipher-batching.mjs';

export async function mountCipherTextarea(element,options={}){
 if(!element||element.tagName!=='TEXTAREA')throw Error('cipher_textarea_required');
 const {signal,...bindingOptions}=options;
 if(signal&&typeof signal.addEventListener!=='function')throw Error('cipher_signal_invalid');
 if(signal?.aborted)throw Error('cipher_mount_cancelled');
 const host=document.createElement('span');host.hidden=true;element.parentElement.appendChild(host);let root;
 try{root=createRoot(host);}catch(error){host.remove();throw error;}
 let resolve,reject,binding=null,closed=false;const ready=new Promise((yes,no)=>{resolve=yes;reject=no;});
 const close=()=>{if(closed)return;closed=true;signal?.removeEventListener('abort',abort);try{binding?.close();}finally{try{root.unmount();}finally{host.remove();}}};
 const abort=()=>{try{close();}catch{}reject(Error('cipher_mount_cancelled'));};
 function Binding(){
  const capture=useCipherCapture('desktop');
  useEffect(()=>{if(closed)return;try{binding=bindDesktopCipher({element,capture,...bindingOptions});resolve(binding);return()=>binding.close();}catch{reject(Error('cipher_mount_failed'));}},[]);
  return null;
 }
 signal?.addEventListener('abort',abort,{once:true});
 try{root.render(React.createElement(Area2Provider,null,React.createElement(Binding)));const attached=await ready;if(closed)throw Error('cipher_mount_cancelled');return{setEnabled:value=>attached.setEnabled(value),finish:()=>attached.finish(),discardWindow:reason=>attached.discardWindow(reason),close};}
 catch(e){close();throw e;}
}

// Offline-only dual-provider experiment. Existing mountCipherTextarea and the
// live workspace do not call this export. No cumulative aggregate is sent.
export async function mountDualCipherExperiment(element,options={}){
 if(!element||element.tagName!=='TEXTAREA')throw Error('cipher_textarea_required');
 const {signal,autoClip=false,clipDriverOptions={},...bindingOptions}=options;
 if(typeof autoClip!=='boolean'||!clipDriverOptions||typeof clipDriverOptions!=='object'||Array.isArray(clipDriverOptions))throw Error('cipher_clip_driver_invalid');
 if(signal&&typeof signal.addEventListener!=='function')throw Error('cipher_signal_invalid');
 if(signal?.aborted)throw Error('cipher_mount_cancelled');
 const host=document.createElement('span');host.hidden=true;element.parentElement.appendChild(host);let root;
 try{root=createRoot(host);}catch(error){host.remove();throw error;}
 let resolve,reject,binding=null,driver=null,closed=false;const captures=[null,null],ready=new Promise((yes,no)=>{resolve=yes;reject=no;});
 const keyup=e=>{if(e.isTrusted===true)queueMicrotask(()=>{if(!closed)driver?.notifyInput();});};
 const close=()=>{if(closed)return;closed=true;signal?.removeEventListener('abort',abort);element.removeEventListener('keyup',keyup);driver?.close();try{binding?.close();}finally{try{root.unmount();}finally{host.remove();}}};
 const abort=()=>{try{close();}catch{}reject(Error('cipher_mount_cancelled'));};
 function Capture({index}){const capture=useCipherCapture('desktop');useEffect(()=>{
  if(closed)return;captures[index]=capture;
  if(captures[0]&&captures[1]&&!binding){try{const logicalStatus=bindingOptions.onLogicalStatus,clipStatus=bindingOptions.onClipStatus;binding=bindDualDesktopCipher({element,fullCapture:captures[0],clipCapture:captures[1],...bindingOptions,onLogicalStatus:(value,meta)=>{if(value==='window_open')driver?.start();if(['window_completed','window_empty','incomplete_window','window_discarded','collector_unavailable','overflow_pending','partial_discarded','waiting_for_consent'].includes(value))driver?.stop();logicalStatus?.(value,meta);},onClipStatus:(value,meta)=>{if(['incomplete_window','collector_unavailable','overflow_pending','partial_discarded'].includes(value))driver?.stop();clipStatus?.(value,meta);}});if(autoClip){driver=createCipherClipDriver({...clipDriverOptions,binding});element.addEventListener('keyup',keyup);}resolve(binding);}catch{reject(Error('cipher_mount_failed'));}}
  return()=>{captures[index]=null;binding?.close();};
 },[]);return null;}
 signal?.addEventListener('abort',abort,{once:true});
 try{root.render(React.createElement(React.Fragment,null,React.createElement(Area2Provider,null,React.createElement(Capture,{index:0})),React.createElement(Area2Provider,null,React.createElement(Capture,{index:1}))));const attached=await ready;if(closed)throw Error('cipher_mount_cancelled');return{setEnabled:value=>{if(!value)driver?.stop();attached.setEnabled(value);},checkpoint:()=>attached.checkpoint(),deferUntil:at=>driver?.deferUntil(at),finish:()=>{driver?.stop();return attached.finish();},discardWindow:reason=>{driver?.stop();attached.discardWindow(reason);},close};}
 catch(error){close();throw error;}
}

// Opt-in temporary cumulative capture; the ordinary binding is unchanged.
export {mountCumulativeCipherTextarea} from './cumulative-experiment.mjs';
