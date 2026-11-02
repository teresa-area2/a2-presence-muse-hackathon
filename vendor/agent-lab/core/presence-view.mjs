// Public projection of an already assessed Presence view, not an eligibility oracle.
// This pure boundary performs no probe, inference, scheduling or model call.
const extents=['terse','standard','full'],timing=['send','defer'],styles=['self_contained','conversational'];
const stamp=x=>typeof x==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x))?new Date(x).toISOString():null;
const safeId=x=>typeof x==='string'&&/^[a-zA-Z0-9:_-]{1,128}$/.test(x)?x:null;
export function presenceView({arm,audience='participant',evidenceMode='unknown',presence=null,decision=null}={}){
 if(!['with','without'].includes(arm)||!['participant','coordinator'].includes(audience)||!['live','replay','fixture','unknown'].includes(evidenceMode))throw TypeError('Invalid Presence view scope');
 const adaptive=arm==='with';
 const result={schema_version:1,arm,audience,evidence_mode:evidenceMode,adaptation_enabled:adaptive,
  presentation:{mode:'ordinary',response_extent:'standard',unsolicited_update:'send'},presence:null,decision:null};
 // Baseline participant data never carries observer state or an observer-driven decision.
 if(!adaptive&&audience==='participant')return result;
 const c=presence?.controls;
 const controls=c&&extents.includes(c.response_extent)&&timing.includes(c.unsolicited_update)&&styles.includes(c.conversation_style)?
  {response_extent:c.response_extent,unsolicited_update:c.unsolicited_update,conversation_style:c.conversation_style}:null;
 const read=stamp(presence?.read_at),receipt=stamp(presence?.received_at);
 const eligible=presence?.eligible===true&&presence?.renderer==='coding-instructions.3'&&controls!==null&&read!==null&&receipt!==null&&Date.parse(read)>=Date.parse(receipt);
 result.presence={scope:adaptive?'adaptation':'observer_only',eligible,controls:eligible?controls:null,
  read_at:read,received_at:receipt,receipt_age_seconds:read&&receipt?(Date.parse(read)-Date.parse(receipt))/1000:null,
  renderer:presence?.renderer==='coding-instructions.3'?'coding-instructions.3':null,
  fallback_reason:eligible?null:'source_unavailable'};
 if(adaptive&&eligible)result.presentation={mode:'eligible_presence',...controls};
 if(adaptive&&decision&&['render_depth','deliver_routine','hold_routine','ordinary_fallback','human_override'].includes(decision.kind)){
  result.decision={kind:decision.kind,event_id:safeId(decision.event_id),read_id:safeId(decision.read_id)};
 }
 return result;
}
