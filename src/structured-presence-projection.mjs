// Allowlisted UI-only metadata. This does not change upstream eligibility or
// the guidance sent to Muse and never forwards arbitrary upstream strings.
const states=new Set(['collecting','waiting_for_input','paused','native_starting','off','fixture','unavailable']);
const reasons=new Set(['native_focus_unavailable','focus_unavailable','focus_changed','inactive_session','poll_error','runtime_not_running','secure_input','unsupported_field','field_safety_unavailable']);
const fallback=new Set(['not_production_live','unsupported_renderer','source_ineligible','stale_or_invalid_receipt','invalid_controls','guidance_missing','retained_policy','stale_receipt']);
const stamp=x=>typeof x==='string'&&x.length<=40&&/(?:Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x))?new Date(x).toISOString():null;
const controls=x=>x&&['terse','standard','full'].includes(x.response_extent)&&['send','defer'].includes(x.unsolicited_update)&&['conversational','self_contained'].includes(x.conversation_style)?{response_extent:x.response_extent,unsolicited_update:x.unsolicited_update,conversation_style:x.conversation_style}:null;
const count=x=>Number.isSafeInteger(x)&&x>=0?x:null;
export function structuredPresenceProjection(value){
 if(!value||typeof value!=='object')return null;const x=value.source;let source=null;
 if(x&&typeof x==='object'){const c=controls(x.controls),renderer=x.renderer==='coding-instructions.3'?x.renderer:null,read_at=stamp(x.read_at),received_at=stamp(x.received_at),eligible=x.eligible===true&&!!c&&!!renderer&&!!read_at&&!!received_at, capture=x.capture&&typeof x.capture==='object'?x.capture:{};source={eligible,controls:eligible?c:null,renderer,read_at,received_at,fallback_reason:eligible?null:(fallback.has(x.fallback_reason)?x.fallback_reason:'source_ineligible'),capture:{state:states.has(capture.state)?capture.state:'unavailable',reason:reasons.has(capture.reason)?capture.reason:null},latency_ms:Number.isFinite(x.latency_ms)&&x.latency_ms>=0?x.latency_ms:null,reads:count(x.reads),evidenceMode:'live',...(x.guidance_lifetime==='active_session'?{guidance_lifetime:'active_session',reading_freshness:eligible&&['fresh','last_known'].includes(x.reading_freshness)?x.reading_freshness:'unavailable'}:{})};}
 const h=value.hook;let hook=null;if(h&&typeof h==='object'){const last=h.last;hook={status:h.status==='workspace_scoped_unverified'?'workspace_scoped_unverified':'unavailable',reads:count(h.reads),eligible:count(h.eligible),last:last&&typeof last==='object'?{eligible:last.eligible===true,read_at:stamp(last.read_at),received_at:stamp(last.received_at),controls:last.eligible===true?controls(last.controls):null}:null};}
 return {source,hook};
}
