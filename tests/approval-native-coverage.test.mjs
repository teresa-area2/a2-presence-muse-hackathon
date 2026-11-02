import test from 'node:test';
import assert from 'node:assert/strict';
import {approvalView} from '../src/approval-view.mjs';
const ctx={sessionId:'s',turnId:'t'};
const make=subject=>({...ctx,approvalId:'a',currentRequirementId:{approvalId:'a',sourceIndex:0},toolName:'tool',subject,rawArgs:'{"arg":"example"}',availableChoices:[{choiceId:'once',label:'Allow once',decision:'approved',scope:'once'},{choiceId:'session',label:'Allow session',decision:'approvedForSession',scope:'session'},{choiceId:'policy',label:'Save policy',decision:'approvedPolicyAmendment',scope:'localPersistent',rulePreview:'allow this exact rule',acceptsFeedback:true},{choiceId:'custom',label:'Other',decision:'futureDecision',scope:'futureScope'}]});
const view=p=>approvalView(p,ctx);
test('all six documented subject kinds and all offered choice scopes and decisions survive',()=>{
 for(const subject of [{kind:'shell',command:'pwd'},{kind:'fileAccess',path:'src/a',access:'read',toolName:'tool'},{kind:'network',host:'example.test',port:443,protocol:'https',toolName:'tool'},{kind:'unixSocket',path:'/tmp/sock',toolName:'tool'},{kind:'process',target:'process 42',access:'control',toolName:'tool'},{kind:'tool',toolName:'tool'}]){
  const v=view(make(subject));assert.equal(v.status,'review',subject.kind);assert.deepEqual(JSON.parse(v.subject_display),subject);assert.deepEqual(v.choices.map(c=>c.scope),['once','session','localPersistent','futureScope']);assert.equal(v.choices[2].acceptsFeedback,true);assert.equal(v.choices[3].decision,'futureDecision');
 }
});
test('future subject requires tool and arguments and displays all fields in escaped JSON',()=>{
 const p=make({kind:'future',toolName:'tool',payload:'left\u202eright'}),v=view(p);assert.equal(v.status,'review');assert.equal(v.subject.kind,'generic');assert.equal(v.subject_display.includes('\u202e'),false);assert.deepEqual(JSON.parse(v.subject_display),p.subject);assert.equal(JSON.parse(v.raw_args_display),p.rawArgs);p.rawArgs='';assert.equal(view(p).status,'review');delete p.rawArgs;assert.equal(view(p).status,'unsupported');
});
test('ordinary tool invocation includes full arguments and fails closed when unavailable',()=>{const p=make({kind:'tool',toolName:'tool'});assert.equal(JSON.parse(view(p).raw_args_display),p.rawArgs);delete p.rawArgs;assert.equal(view(p).status,'unsupported');});
test('judge escalation context is displayed as context and changes the token',()=>{const p=make({kind:'tool',toolName:'tool'}),a=view(p);p.judgeEscalated=true;p.reviewerReason='Please review \u202e carefully';const b=view(p);assert.equal(b.judge_escalated,true);assert.equal(JSON.parse(b.reviewer_reason_display),p.reviewerReason);assert.notEqual(a.review_token,b.review_token);assert.ok(!b.reviewer_reason_display.includes('\u202e'));});
test('invalid known subject is not downgraded to generic',()=>{for(const subject of [{kind:'network',toolName:'tool'},{kind:'unixSocket',toolName:'tool'},{kind:'process',target:'x',access:'write',toolName:'tool'}])assert.equal(view(make(subject)).status,'unsupported');});
test('CUA exposes only documented facts and masks, excludes raw args and binds them to token',()=>{
 const p=make({kind:'tool',toolName:'tool'});p.availableChoices=[p.availableChoices[0]];p.rawArgs='SECRET_NEVER_DISPLAY';p.cuaCardFacts={windowTitle:'Window',page:{host:'example.test',hostAscii:'example.test'},steps:[{step:1,kind:'verb:click',action:'click',label:'Continue',effect:'opens page',point:{x:3,y:4}}],data:[{kind:'secret',secretKind:'token',mask:{prefix:'abc_',last4:'1234',chars:40}}]};
 let v=view(p);assert.equal(v.status,'review');assert.deepEqual(JSON.parse(v.cua_card_display),p.cuaCardFacts);assert.equal(v.raw_args_omitted,'cua_sensitive_input');assert.ok(!JSON.stringify(v).includes('SECRET_NEVER_DISPLAY'));let token=v.review_token;p.rawArgs='OTHER_SECRET';assert.notEqual(view(p).review_token,token);p.cuaCardFacts.data[0].value='SECRET_NEVER_DISPLAY';assert.equal(view(p).status,'unsupported');
});
test('native choice IDs are opaque and need not use the older restricted identifier alphabet',()=>{const p=make({kind:'tool',toolName:'tool'});p.availableChoices[0].choiceId='host choice / Ω';assert.equal(view(p).choices[0].choiceId,'host choice / Ω');});
test('child origin and all material fields are bound to the review token',()=>{
 const p=make({kind:'tool',toolName:'tool'});p.subagentOrigin={childRunId:'run',childSessionId:'child',subagentId:'agent'};const a=view(p);assert.deepEqual(a.subagent_origin,p.subagentOrigin);p.subagentOrigin.childRunId='other';assert.notEqual(view(p).review_token,a.review_token);p.subagentOrigin.childRunId='run';p.availableChoices[2].acceptsFeedback=false;assert.notEqual(view(p).review_token,a.review_token);p.subagentOrigin.childSessionId='';assert.equal(view(p).status,'unsupported');
});
test('long exact shell and output budget never truncate or overrun',()=>{
 const p=make({kind:'shell',command:'x'.repeat(50000)}),v=view(p);assert.equal(v.command,p.subject.command);assert.deepEqual(JSON.parse(v.subject_display),p.subject);p.subject.command='x'.repeat(256*1024+1);assert.equal(view(p).reason,'subject_too_large');
 const q=make({kind:'future',toolName:'tool',blob:'\n'.repeat(120000)});q.rawArgs='x'.repeat(200000);assert.equal(view(q).reason,'subject_too_large');
});

test('protected writes and CUA data reject broader or policy choices before review',()=>{
 for(const extra of [{choiceId:'broad',label:'Session',scope:'session',decision:'approvedForSession'},{choiceId:'policy',label:'Policy',scope:'once',decision:'approvedPolicyAmendment'},{choiceId:'unknown',label:'Unknown',scope:'once',decision:'future'}]){
  const p=make({kind:'fileAccess',path:'src/a',access:'write',toolName:'tool'});p.protectedWrite=true;p.availableChoices=[p.availableChoices[0],extra];assert.equal(view(p).reason,'choices_unavailable');
  const c=make({kind:'tool',toolName:'tool'});c.cuaCardFacts={data:[{kind:'other'}]};c.availableChoices=[c.availableChoices[0],extra];assert.equal(view(c).reason,'choices_unavailable');
 }
 const p=make({kind:'fileAccess',path:'src/a',access:'write',toolName:'tool'});p.protectedWrite=true;p.availableChoices=[p.availableChoices[0],{choiceId:'no',label:'Reject',scope:'once',decision:'denied'}];assert.equal(view(p).status,'review');
});
test('native additive subject, origin, stage and choice fields are fully visible and token-bound',()=>{
 const file=make({kind:'fileAccess',path:'src/a',access:'write',toolName:'tool',extension:{hint:'visible'},origin:{kind:'futureOrigin',detail:'visible too'}});file.availableChoices[0].extension={meaning:'visible'};const v=view(file);assert.equal(v.status,'review');assert.deepEqual(JSON.parse(v.subject_display),file.subject);assert.deepEqual(JSON.parse(v.choices[0].native_display),file.availableChoices[0]);const token=v.review_token;file.availableChoices[0].extension.meaning='changed';assert.notEqual(view(file).review_token,token);
 const shell=make({kind:'shell',command:'pwd',extra:'visible',stages:[{argv:['pwd'],argvComplete:true,position:1,totalStages:1,requirementId:{approvalId:'a',sourceIndex:0},resolution:{kind:'unresolved',extra:'visible'},extra:'stage-visible'}]});const sv=view(shell);assert.equal(sv.status,'review');assert.deepEqual(JSON.parse(sv.subject_display),shell.subject);assert.deepEqual(sv.subject.stage.argv,['pwd']);shell.subject.stages[0].position=2;assert.equal(view(shell).status,'unsupported');
});
test('CUA choice extensions fail closed instead of disclosing unexpected secret-bearing fields',()=>{const p=make({kind:'tool',toolName:'tool'});p.cuaCardFacts={data:[{kind:'other'}]};p.availableChoices=[{...p.availableChoices[0],extension:'SECRET'}];const v=view(p);assert.equal(v.reason,'choices_unavailable');assert.ok(!JSON.stringify(v).includes('SECRET'));});
