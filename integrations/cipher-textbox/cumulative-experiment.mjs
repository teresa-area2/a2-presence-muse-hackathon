// Cumulative Cipher integration: separate providers, existing serialized caller.
// No OP call or persistence is performed here.
import React,{useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {Area2Provider,useCipherCapture} from '@area2-ai/a2-cipher-react';
import {bindCumulativeCipherExperiment} from '../../web/cipher-cumulative-experiment.mjs';
import {createCipherClipDriver} from '../../web/cipher-batching.mjs';

export async function mountCumulativeCipherExperiment(element,{poolSize=3,signal,autoClip=false,rearm=false,clipDriverOptions={},nowMonotonic=()=>performance.now(),nowWall=Date.now,onSnapshot,onStatus=()=>{}}={}){
 if(!element||element.tagName!=='TEXTAREA'||!Number.isSafeInteger(poolSize)||poolSize<2||poolSize>5||typeof autoClip!=='boolean'||typeof rearm!=='boolean'||typeof onSnapshot!=='function'||typeof onStatus!=='function'||!clipDriverOptions||typeof clipDriverOptions!=='object'||Array.isArray(clipDriverOptions))throw Error('cipher_cumulative_invalid');
 if(signal&&typeof signal.addEventListener!=='function')throw Error('cipher_signal_invalid');if(signal?.aborted)throw Error('cipher_mount_cancelled');
 const host=document.createElement('span');host.hidden=true;element.parentElement.appendChild(host);let root;
 try{root=createRoot(host);}catch(error){host.remove();throw error;}
 let resolve,reject,binding=null,driver=null,closed=false,enabled=false,swapping=false;const captures=Array(poolSize).fill(null),quarantines=Array.from({length:poolSize},()=>new Set()),ready=new Promise((yes,no)=>{resolve=yes;reject=no;});
 const keyup=e=>{if(e.isTrusted===true)queueMicrotask(()=>{if(!closed)driver?.notifyInput();});};
 const close=()=>{if(closed)return;closed=true;enabled=false;signal?.removeEventListener('abort',abort);element.removeEventListener('keyup',keyup);driver?.close();try{binding?.close();}finally{try{root.unmount();}finally{host.remove();}}};
 const abort=()=>{try{close();}catch{}reject(Error('cipher_mount_cancelled'));};
 const fail=()=>{enabled=false;driver?.stop();try{binding?.close();}catch{}try{onStatus('collector_unavailable');}catch{}};
 function rebuild(){
  if(closed||!captures.every(Boolean))return false;swapping=true;const old=binding;binding=null;
  try{old?.close();const next=bindCumulativeCipherExperiment({element,captures:[...captures],quarantines,nowMonotonic,nowWall,onSnapshot:(payload,meta)=>{
   if(closed||!enabled)return;
   const result=onSnapshot(payload,meta);
   if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw Error('cumulative_enqueue_not_synchronous');}
   if(meta.kind==='final'&&rearm&&!closed&&enabled)rebuild();
  },onStatus:(value,meta)=>{
   if(swapping||closed)return;
   if(value==='window_open')driver?.start();
   if(['window_completed','window_empty','window_discarded','incomplete_window','partial_discarded','overflow_pending','collector_unavailable','waiting_for_consent','experiment_unavailable'].includes(value))driver?.stop();
   onStatus(value,meta);
   if((value==='window_empty'||value==='incomplete_window')&&rearm&&!closed&&enabled){const previous=binding;queueMicrotask(()=>{if(!closed&&enabled&&binding===previous)rebuild();});}
  }});binding=next;swapping=false;if(enabled)next.setEnabled(true);return true;}
  catch{swapping=false;fail();return false;}
 }
 function Capture({index}){const capture=useCipherCapture('desktop');useEffect(()=>{
  if(closed)return;captures[index]=capture;
  if(captures.every(Boolean)&&!binding){try{if(!rebuild())throw Error('cipher_mount_failed');if(autoClip){driver=createCipherClipDriver({...clipDriverOptions,binding:{checkpoint:()=>binding?.checkpoint()??{status:'unavailable'},hasCompletedInput:()=>binding?.hasCompletedInput()===true,hasMinimumInput:()=>binding?.hasMinimumInput()===true}});element.addEventListener('keyup',keyup);}resolve();}catch{reject(Error('cipher_mount_failed'));}}
  return()=>{captures[index]=null;binding?.close();};
 },[]);return null;}
 signal?.addEventListener('abort',abort,{once:true});
 try{root.render(React.createElement(React.Fragment,null,...Array.from({length:poolSize},(_,i)=>React.createElement(Area2Provider,{key:i},React.createElement(Capture,{index:i})))));
  await ready;if(closed)throw Error('cipher_mount_cancelled');return{
   setEnabled(value){if(closed||typeof value!=='boolean'||!binding)throw Error('cipher_cumulative_unavailable');enabled=value;if(!value){driver?.stop();binding.setEnabled(false);}else binding.setEnabled(true);},
   checkpoint:()=>binding?.checkpoint()??{status:'unavailable'},deferUntil:at=>driver?.deferUntil(at),
   finish(){driver?.stop();return binding?.finish();},
   discardWindow(reason){driver?.stop();const previous=binding;previous?.discardWindow(reason);if(rearm&&!closed&&enabled){if(binding===previous)rebuild();}else enabled=false;},close};
 }catch(error){close();throw error;}
}

// Shared entry point for the normal bundle. A fresh logical pool is prepared
// synchronously after each completed/empty window, using already-mounted SDKs.
export function mountCumulativeCipherTextarea(element,options={}){
 return mountCumulativeCipherExperiment(element,{...options,poolSize:options.poolSize??5,rearm:true,autoClip:true,clipDriverOptions:{...options.clipDriverOptions,firstSampleMinMs:5000}});
}
