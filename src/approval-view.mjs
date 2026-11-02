// Project only native approvals a person can review without broadening authority.
// This projection and its token are ephemeral; never store raw approval details.
import {createHash} from 'node:crypto';
const MAX_FIELD=256*1024, MAX_VIEW=512*1024;
const ref=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(x);
const record=x=>x&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x))&&Object.values(Object.getOwnPropertyDescriptors(x)).every(d=>Object.hasOwn(d,'value'));
const safe=(s,max,multiline=false)=>typeof s==='string'&&s.length>0&&s.length<=max&&!/[\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(s)&&(!multiline?!/[\u0000-\u001f\u007f-\u009f]/u.test(s):!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(s));
const unsupported=reason=>({status:'unsupported',reason});
const keys=(x,allowed)=>record(x)&&Object.keys(x).every(k=>allowed.includes(k));
const escaped=value=>JSON.stringify(value,null,2).replace(/[\u007f-\u009f\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu,c=>[...c].map(ch=>Array.from({length:ch.length},(_,i)=>'\\u'+ch.charCodeAt(i).toString(16).padStart(4,'0')).join('')).join(''));
const boundedString=(s,max=MAX_FIELD)=>typeof s==='string'&&s.length>0&&Buffer.byteLength(s)<=max;
// Stage arguments are native strings, not single-line labels. JSON display escapes
// their contents; the field and complete-review byte budgets still apply.
const argumentString=s=>typeof s==='string'&&Buffer.byteLength(s)<=MAX_FIELD;
const reviewableArgv=value=>Array.isArray(value)&&value.every(argumentString);
function validCua(c){
 if(!keys(c,['windowTitle','page','steps','data']))return false;
 if(c.windowTitle!==undefined&&!boundedString(c.windowTitle))return false;
 if(c.page!==undefined&&(!keys(c.page,['host','hostAscii'])||!boundedString(c.page.host)||!boundedString(c.page.hostAscii)))return false;
 if(c.steps!==undefined&&(!Array.isArray(c.steps)||c.steps.length>256||!c.steps.every(x=>keys(x,['action','effect','kind','step','chord','label','point','roleWord'])&&['action','effect','kind'].every(k=>boundedString(x[k]))&&Number.isSafeInteger(x.step)&&x.step>0&&['chord','label','roleWord'].every(k=>x[k]===undefined||typeof x[k]==='string'&&Buffer.byteLength(x[k])<=MAX_FIELD)&&(x.point===undefined||keys(x.point,['x','y'])&&Number.isSafeInteger(x.point.x)&&Number.isSafeInteger(x.point.y)&&x.point.x>=0&&x.point.x<=1000&&x.point.y>=0&&x.point.y<=1000))))return false;
 if(c.data!==undefined&&(!Array.isArray(c.data)||c.data.length>256||!c.data.every(x=>keys(x,['kind','secretKind','mask'])&&boundedString(x.kind)&&(x.secretKind===undefined||boundedString(x.secretKind))&&(x.mask===undefined||keys(x.mask,['chars','last4','prefix'])&&(x.mask.chars===undefined||Number.isSafeInteger(x.mask.chars)&&x.mask.chars>=0)&&(x.mask.last4===undefined||typeof x.mask.last4==='string'&&[...x.mask.last4].length<=4)&&(x.mask.prefix===undefined||typeof x.mask.prefix==='string'&&x.mask.prefix.length<=256)))))return false;
 return true;
}
function stable(value){if(Array.isArray(value))return value.map(stable);if(record(value))return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));return value;}
export function approvalView(p,{sessionId,turnId}={}){
 const r=p?.currentRequirementId;
 if(!record(p)||!ref(sessionId)||!ref(turnId)||p.sessionId!==sessionId||p.turnId!==turnId||!ref(p.approvalId)||!keys(r,['approvalId','sourceIndex'])||r.approvalId!==p.approvalId||!Number.isSafeInteger(r.sourceIndex)||r.sourceIndex<0)return unsupported('invalid_identity');
 if(p.subagentOrigin!==undefined&&(!keys(p.subagentOrigin,['childRunId','childSessionId','subagentId'])||!['childRunId','childSessionId','subagentId'].every(k=>ref(p.subagentOrigin[k]))))return unsupported('invalid_identity');
 if(!record(p.subject)||!boundedString(p.subject.kind,256))return unsupported('unsupported_subject');
 if(p.cuaCardFacts!==undefined&&!validCua(p.cuaCardFacts))return unsupported('unsupported_subject');
 if(p.cuaCardFacts!==undefined&&(!keys(p.subject,['kind','toolName'])||p.subject.kind!=='tool'))return unsupported('unsupported_subject');
 const sub=p.subject;let subject,command;
 if(sub.kind==='fileAccess'){
  if(r.sourceIndex!==0)return unsupported('unsupported_subject');
  const toolName=sub.toolName??p.toolName;
  if(!['read','write'].includes(sub.access)||typeof sub.path!=='string'||!ref(toolName)||sub.toolName!==undefined&&p.toolName!==undefined&&sub.toolName!==p.toolName)return unsupported('missing_subject_details');
  if(sub.path.length>4096)return unsupported('subject_too_large');if(!safe(sub.path,4096))return unsupported('unsafe_display_characters');
  let origin=null;if(sub.origin!==undefined){const o=sub.origin;if(!record(o)||!boundedString(o.kind,256))return unsupported('unsupported_subject');if(o.kind==='shellCommand'){if(typeof o.command!=='string'||!o.command)return unsupported('missing_subject_details');if(Buffer.byteLength(o.command)>MAX_FIELD)return unsupported('subject_too_large');if(!safe(o.command,MAX_FIELD,true))return unsupported('unsafe_display_characters');origin={kind:'shellCommand',command:o.command};}else if(o.kind==='url'){if(!safe(o.url,4096))return unsupported('unsupported_subject');origin={kind:'url',url:o.url};}}
  subject={kind:'fileAccess',path:sub.path,access:sub.access,toolName,...(origin?{origin}:{})};
 }else if(sub.kind==='shell'){

  if(typeof sub.command!=='string'||!sub.command)return unsupported('missing_subject_details');
  if(Buffer.byteLength(sub.command)>MAX_FIELD)return unsupported('subject_too_large');if(!safe(sub.command,MAX_FIELD,true))return unsupported('unsafe_display_characters');
  if(sub.workspaceRoot!==undefined&&(typeof sub.workspaceRoot!=='string'||!sub.workspaceRoot))return unsupported('missing_subject_details');
  if(typeof sub.workspaceRoot==='string'&&sub.workspaceRoot.length>4096)return unsupported('subject_too_large');if(typeof sub.workspaceRoot==='string'&&!safe(sub.workspaceRoot,4096))return unsupported('unsafe_display_characters');
  const stages=sub.stages;if(stages!==undefined&&!Array.isArray(stages))return unsupported('unsupported_subject');
  if(stages?.length>32)return unsupported('subject_too_large');if(!stages?.length&&r.sourceIndex!==0)return unsupported('unsupported_subject');let stage=null;
  if(stages?.length){if(r.sourceIndex>=stages.length)return unsupported('unsupported_subject');try{if(Buffer.byteLength(JSON.stringify(stages),'utf8')>MAX_VIEW)return unsupported('subject_too_large');}catch{return unsupported('unsupported_subject');}
   for(const [i,x] of stages.entries()){
    if(!record(x)||!reviewableArgv(x.argv)||typeof x.argvComplete!=='boolean'||x.position!==i+1||x.totalStages!==stages.length||!keys(x.requirementId,['approvalId','sourceIndex'])||x.requirementId.approvalId!==p.approvalId||x.requirementId.sourceIndex!==i||!record(x.resolution)||!safe(x.resolution.kind,256))return unsupported('unsupported_subject');
    const resolution=x.resolution;if(resolution.diagnostic!==undefined&&(resolution.kind!=='policyAllow'||!argumentString(resolution.diagnostic)))return unsupported('unsupported_subject');if(resolution.argvPrefix!==undefined&&(resolution.kind!=='policyAmendment'||!reviewableArgv(resolution.argvPrefix)))return unsupported('unsupported_subject');
    if(x.suggestedPrefix!==undefined){const sp=x.suggestedPrefix;if(!x.argvComplete||!record(sp)||!reviewableArgv(sp.argvPrefix)||!argumentString(sp.label))return unsupported('unsupported_subject');}
    if(i===r.sourceIndex){if(resolution.kind!=='unresolved')return unsupported('unsupported_subject');stage={position:i+1,totalStages:stages.length,argvComplete:x.argvComplete,argv:x.argv.slice()};}
   }
  }
  command=sub.command;subject={kind:'shell',workspaceRoot:sub.workspaceRoot??null,stage};
 }else{
  const toolName=sub.toolName??p.toolName;
  if(!ref(toolName)||sub.toolName!==undefined&&p.toolName!==undefined&&sub.toolName!==p.toolName)return unsupported('missing_subject_details');
  const known=['network','unixSocket','process','tool'].includes(sub.kind);
  if(known&&r.sourceIndex!==0)return unsupported('unsupported_subject');
  if(sub.kind==='network'&&(!boundedString(sub.host)||sub.port!==undefined&&(!Number.isSafeInteger(sub.port)||sub.port<0||sub.port>65535)||sub.protocol!==undefined&&!boundedString(sub.protocol)))return unsupported('missing_subject_details');
  if(sub.kind==='unixSocket'&&!boundedString(sub.path))return unsupported('missing_subject_details');
  if(sub.kind==='process'&&(!boundedString(sub.target)||sub.access!=='control'))return unsupported('missing_subject_details');
  if((!known||sub.kind==='tool'&&p.cuaCardFacts===undefined)&&!(typeof p.rawArgs==='string'&&Buffer.byteLength(p.rawArgs)<=MAX_FIELD))return unsupported('missing_subject_details');
  // The full JSON display escapes invisible controls for every subject; the
  // structured form is only emitted when its native values are safe to render.
  const allSafe=v=>typeof v==='string'?(v===''||safe(v,MAX_FIELD,true)):Array.isArray(v)?v.every(allSafe):record(v)?Object.values(v).every(allSafe):v===null||typeof v==='boolean'||typeof v==='number';
  let safeFields;try{safeFields=allSafe(sub);}catch{return unsupported('unsupported_subject');}
  subject=known&&safeFields?{...sub,toolName}:{kind:'generic',toolName};
 }

 if(p.judgeEscalated!==undefined&&typeof p.judgeEscalated!=='boolean'||p.reviewerReason!==undefined&&!(typeof p.reviewerReason==='string'&&Buffer.byteLength(p.reviewerReason)<=MAX_FIELD))return unsupported('missing_subject_details');
 if(p.protectedWrite!==undefined&&typeof p.protectedWrite!=='boolean')return unsupported('missing_subject_details');
 if(!Array.isArray(p.availableChoices)||p.availableChoices.length===0||p.availableChoices.length>16)return unsupported('choices_unavailable');
 const seen=new Set(),choices=[];
 for(const c of p.availableChoices){if(!record(c)||!boundedString(c.choiceId,1024))return unsupported('choices_ambiguous');if(seen.has(c.choiceId))return unsupported('choices_ambiguous');seen.add(c.choiceId);
  if(p.cuaCardFacts!==undefined&&!keys(c,['choiceId','label','decision','scope','rulePreview','acceptsFeedback']))return unsupported('choices_unavailable');
  if(p.protectedWrite===true&&(c.scope!=='once'||!['approved','denied'].includes(c.decision))||p.cuaCardFacts?.data?.length>0&&(c.scope!=='once'||!['approved','denied','abort','timedOut'].includes(c.decision)))return unsupported('choices_unavailable');
  if(!safe(c.label,MAX_FIELD,true)||!safe(c.scope,256)||!safe(c.decision,256)||c.rulePreview!==undefined&&!safe(c.rulePreview,MAX_FIELD,true)||c.acceptsFeedback!==undefined&&typeof c.acceptsFeedback!=='boolean')return unsupported('choices_unavailable');
  choices.push({choiceId:c.choiceId,label:c.label,decision:c.decision,scope:c.scope,...(c.rulePreview!==undefined?{rulePreview:c.rulePreview}:{}),...(c.acceptsFeedback!==undefined?{acceptsFeedback:c.acceptsFeedback}:{}),...(!keys(c,['choiceId','label','decision','scope','rulePreview','acceptsFeedback'])?{native_display:escaped(c)}:{})});
 }

 let review_token;try{const value=JSON.stringify(stable(p));if(Buffer.byteLength(value)>MAX_VIEW)return unsupported('subject_too_large');review_token=createHash('sha256').update(value).digest('hex');}catch{return unsupported('unknown');}
 const view={status:'review',projection_version:2,display_complete:true,approvalId:p.approvalId,requirementId:{approvalId:r.approvalId,sourceIndex:r.sourceIndex},...(command!==undefined?{command}:{}),subject,subject_display:escaped(sub),protectedWrite:p.protectedWrite===true,choices,review_token,decision_pending:false,
 ...(p.subagentOrigin?{subagent_origin:{...p.subagentOrigin}}:{}),
 ...(p.judgeEscalated!==undefined?{judge_escalated:p.judgeEscalated}:{}),...(p.reviewerReason!==undefined?{reviewer_reason_display:escaped(p.reviewerReason)}:{}),
 ...(p.cuaCardFacts!==undefined?{cua_card_display:escaped(p.cuaCardFacts),raw_args_omitted:'cua_sensitive_input'}:(sub.kind==='tool'||!['shell','fileAccess','network','unixSocket','process'].includes(sub.kind)?{raw_args_display:escaped(p.rawArgs)}:{}))};
 try{if(Buffer.byteLength(JSON.stringify(view))>MAX_VIEW)return unsupported('subject_too_large');}catch{return unsupported('unknown');}
 return view;
}
