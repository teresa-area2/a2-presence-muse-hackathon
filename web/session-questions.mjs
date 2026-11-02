// Native Muse questions are conversation input, never command approval.
const bounded=(x,n)=>typeof x==='string'&&x.length>0&&Array.from(x).length<=n;
export function questionFingerprint(prompt){
 if(!prompt||!bounded(prompt.userInputId,160)||!bounded(prompt.turnId,160)||!Array.isArray(prompt.questions)||prompt.questions.length<1||prompt.questions.length>3)return null;
 const seen=new Set();
 for(const q of prompt.questions){
  if(!q||!bounded(q.id,64)||seen.has(q.id)||!bounded(q.header,12)||!bounded(q.question,2097152)||!['single','multiple'].includes(q.selection?.mode)||!Array.isArray(q.options)||q.options.length<2||q.options.length>3)return null;
  seen.add(q.id);const labels=new Set();for(const o of q.options){if(!bounded(o?.label,80)||labels.has(o.label)||o.description!==undefined&&(typeof o.description!=='string'||Array.from(o.description).length>240))return null;labels.add(o.label);}
 }
 return JSON.stringify([prompt.userInputId,prompt.turnId,prompt.questions]);
}
export function currentQuestion(state,arm,userInputId=null){
 const a=state?.arms?.[arm];if(state?.status!=='ready'||!['with','without'].includes(arm)||!['question','approval'].includes(a?.status)||!Array.isArray(a.questions)||a.questions.length<1)return null;
 const q=userInputId===null?(a.questions.length===1?a.questions[0]:null):a.questions.find(p=>p.userInputId===userInputId);return questionFingerprint(q)?q:null;
}
export function canActOnQuestion({state,arm,prompt,connected,pending=false}){
 const current=currentQuestion(state,arm,prompt?.userInputId);return connected===true&&pending===false&&!!current&&current.busy!==true&&questionFingerprint(current)===questionFingerprint(prompt);
}
export function questionReplyReady({state,target,text,connected,pending,uncertain,userInputId=null}){
 return ['with','without'].includes(target)&&connected===true&&pending===false&&!!currentQuestion(state,target,userInputId)&&currentQuestion(state,target,userInputId).busy!==true&&typeof text==='string'&&!!text.trim()&&Array.from(text).length<=500;
}
// A reply draft remains bound to its original native prompt after timeout/settlement.
// Only explicit recipient selection starts a new message intent.
export function questionComposerRoute({state,target,intent=null}){
 if(intent){const prompt=currentQuestion(state,target,intent.userInputId);if(intent.arm!==target||intent.generation!==state?.session_generation||!prompt||questionFingerprint(prompt)!==intent.fingerprint)return{kind:'stale_reply'};return{kind:'reply',prompt};}
 const prompt=currentQuestion(state,target);return prompt?{kind:'reply',prompt}:{kind:'message'};
}
