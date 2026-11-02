// Pulse renderer and animator reused from a2-presence-command. Display proxies only.
import {presencePrintSvg,printEncoding,presencePrintFrame,interpolatePrintFrames,printPath,printBreathStyle} from './presence-print.mjs';
const PRINT_EMPTY='<span class="pulse-unavailable-shape" aria-hidden="true">◌</span>';
// Exact existing display convention: a2-presence-muse/macOS PulseProxy.swift.
const EXTENT={terse:.25,standard:.50,full:.75},TIMING={send:.25,defer:.75},STYLE={self_contained:.25,conversational:.75};
export function capsulePulse(meta,now=Date.now()){
 const stamp=meta?.received_at;
 const receipt=typeof stamp==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(stamp)?Date.parse(stamp):NaN;
 const age=(now-receipt)/1000,c=meta?.controls;
 if(meta?.eligible!==true||meta?.renderer!=='coding-instructions.3'||!Number.isFinite(age)||age<0||meta?.fallback_reason)return null;
 const values=[EXTENT[c?.response_extent],TIMING[c?.unsolicited_update],STYLE[c?.conversation_style]];
 return values.every(Number.isFinite)?values:null;
}
export function mountPulse(element){
 element.classList.add('presence-pulse');
 element.innerHTML='<div class="pulse-art"></div><div class="pulse-copy"><strong class="pulse-status">Presence unavailable</strong><span class="pulse-values">No fresh capsule</span></div>';
 const art=element.querySelector('.pulse-art'),status=element.querySelector('.pulse-status'),numbers=element.querySelector('.pulse-values');
 const animator=new PresencePrintAnimator(art);let metadata=null,signature='';
 function paint(){
  const values=capsulePulse(metadata);
  const key=JSON.stringify(values);element.dataset.available=String(Boolean(values));
  if(key!==signature){signature=key;if(values){animator.update(values);animator.setActive(true);}else{animator.clear();animator.setActive(false);}}
  const reason=metadata?.fallback_reason;status.textContent=values?'Latest capsule · Pulse proxy':!metadata?'Checking Presence':reason==='retained_policy'?'Presence paused':reason==='stale_or_invalid_receipt'||reason==='stale_receipt'?'Waiting for a fresh capsule':'Presence unavailable';
  numbers.textContent=values?`R ${values[0].toFixed(2)} · F ${values[1].toFixed(2)} · S ${values[2].toFixed(2)} · age ${Math.max(0,Math.floor((Date.now()-Date.parse(metadata.received_at))/1000))}s`:!metadata?'Connecting to the local adapter':reason==='retained_policy'?'Latest capsule retained; adaptation paused':reason==='stale_or_invalid_receipt'||reason==='stale_receipt'?'Source marked the receipt ineligible':reason?.replaceAll('_',' ')??'Waiting for the local adapter';
  const svg=art.querySelector('svg');if(svg)svg.setAttribute('aria-label',`Capsule-derived display proxy, not measured RFS: readiness ${values[0]}, flow ${values[1]}, stability ${values[2]}`);
 }
 const timer=setInterval(paint,1000);paint();
 return {update(meta){metadata=meta;paint();},close(){clearInterval(timer);animator.close();}};
}
export const PRINT_TRANSITION_MS=900;
export class PresencePrintAnimator {
  constructor(root,{request=fn=>requestAnimationFrame(fn),cancel=id=>cancelAnimationFrame(id),now=()=>performance.now(),motion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)'),doc=root.ownerDocument}={}){
    Object.assign(this,{root,request,cancel,now,motion,doc});
    this.active=false;
    this.onMotion=()=>{if(this.motion?.matches)this.finish();this.syncGlow();};
    this.onVisibility=()=>{if(this.doc?.hidden)this.finish();this.syncGlow();};
    motion?.addEventListener('change',this.onMotion);doc?.addEventListener('visibilitychange',this.onVisibility);
  }
  setActive(active){this.active=Boolean(active);this.syncGlow();}
  syncGlow(){this.root.dataset.ambient=this.svg&&this.active&&!this.motion?.matches&&!this.doc?.hidden?'running':'paused';}
  update(values,{animate=true}={}){
    const target=presencePrintFrame(...values);if(!target){this.clear();return;}
    // Advance to the precise interruption time before retargeting a changing stream.
    if(this.transition)this.sample(this.now());
    this.stop();this.target=target;
    if(!this.svg){
      this.root.innerHTML=presencePrintSvg(...values,{animationSlots:true});
      this.svg=this.root.querySelector('svg');this.rings=[...this.svg.querySelectorAll('[data-print-ring]')];this.accent=[...this.svg.querySelectorAll('[data-print-accent] path')];this.accentGroup=this.svg.querySelector('[data-print-accent]');
    }
    const encoding=printEncoding(...values);
    this.rings.forEach((ring,i)=>ring.setAttribute('style',printBreathStyle(Math.min(i+1,encoding.rings)/encoding.rings,values[2])));
    this.accentGroup.setAttribute('style',printBreathStyle((encoding.accent+1)/encoding.rings,values[2]));
    this.syncGlow();
    this.svg.setAttribute('aria-label',`Presence Pulse: readiness ${values[0].toFixed(3)}, flow ${values[1].toFixed(3)}, stability ${values[2].toFixed(3)}`);
    if(!this.current||!animate||this.motion?.matches||this.doc?.hidden){this.paint(target);return;}
    this.transition={from:this.current,to:target,start:this.now()};this.root.dataset.transitioning='true';
    const tick=time=>{this.frameId=null;this.sample(time);if(this.transition)this.frameId=this.request(tick);};
    this.frameId=this.request(tick);
  }
  sample(time){
    const t=Math.min(1,Math.max(0,(time-this.transition.start)/PRINT_TRANSITION_MS)),eased=t*t*(3-2*t);
    this.paint(t===1?this.transition.to:interpolatePrintFrames(this.transition.from,this.transition.to,eased));
    if(t===1){this.transition=null;delete this.root.dataset.transitioning;}
  }
  paint(frame){
    this.current=frame;
    frame.rings.forEach((ring,i)=>{this.rings[i].setAttribute('d',printPath(ring.points)+' Z');this.rings[i].setAttribute('stroke-opacity',ring.opacity.toFixed(4));});
    this.accent.forEach((segment,i)=>{segment.setAttribute('d',printPath([frame.accentPoints[i],frame.accentPoints[i+1]]));segment.setAttribute('stroke',`rgb(${frame.colors[i].map(Math.round).join(',')})`);});
  }
  stop(){if(this.frameId!=null)this.cancel(this.frameId);this.frameId=null;this.transition=null;delete this.root.dataset.transitioning;}
  finish(){this.stop();if(this.target&&this.svg)this.paint(this.target);}
  clear(){this.stop();this.current=this.target=this.svg=null;this.syncGlow();this.root.innerHTML=PRINT_EMPTY;}
  close(){this.setActive(false);this.stop();this.motion?.removeEventListener('change',this.onMotion);this.doc?.removeEventListener('visibilitychange',this.onVisibility);}
}
