import test from'node:test';import assert from'node:assert/strict';import{sendCIFeedback}from'../src/session-ci-api.mjs';import{codeChecksView}from'../web/session-code-checks.mjs';import{projectCodeChecks}from'../src/session-ci-evidence.mjs';
function fake(){const events=[];const service={feedback:async()=>{events.push('prepare');return{commit(){events.push('commit');return{prompts:{without:'own left CI',with:'own right CI'},expectedTurns:{without:null,with:null}}}}}};const pair={submit:async(text,arm,options)=>{events.push({arm,text,options});return{status:'started',arms:{[arm]:{status:'started'}}};}};return{events,service,pair};}
test('explicit CI send uses each own report, ready bindings and one synchronous claim',async()=>{const x=fake();const out=await sendCIFeedback({...x,target:'both',checks:{}});assert.equal(out.status,'started');assert.equal(out.source,'generated_ci');assert.deepEqual(x.events,['prepare','commit',{arm:'without',text:'own left CI',options:{expectedTurns:{without:null}}},{arm:'with',text:'own right CI',options:{expectedTurns:{with:null}}}]);});
test('generation change during preparation never claims or dispatches',async()=>{const x=fake();await assert.rejects(sendCIFeedback({...x,target:'both',checks:{},isCurrent:()=>false}),/ci_session_changed/);assert.deepEqual(x.events,['prepare']);});
test('partial feedback dispatch remains explicit and never retries unknown side',async()=>{const x=fake();let n=0;x.pair.submit=async()=>{if(++n===2)throw Error('transport');return{status:'started'};};const out=await sendCIFeedback({...x,target:'both',checks:{}});assert.equal(n,2);assert.equal(out.status,'partial_or_unconfirmed');assert.deepEqual(out.arms,{without:{status:'started'},with:{status:'unknown'}});});
test('native work is not steered if the selected CI receiver became busy',async()=>{const x=fake();x.pair.submit=async(text,arm,options)=>{assert.equal(options.expectedTurns[arm],null);return{status:'not_started',arms:{[arm]:{status:'not_started'}}};};const out=await sendCIFeedback({...x,target:'with',checks:{}});assert.equal(out.status,'not_started');});
const id='11111111-1111-1111-1111-111111111111',counts={tests:2,pass:2,fail:0,skipped:0,cancelled:0,todo:0};
const record=arm=>({id,arm,status:'passed',current:true,feedback_available:true,at:'2026-11-01T00:00:00.000Z',elapsed_ms:10,summary:{state:'passed',exit_code:0,public_tests:counts,frozen_tests:counts,artifact_sha256:'a'.repeat(64),trusted_plan_hash:'b'.repeat(64),stdout:'SECRET RAW OUTPUT',cases:[{name:'PRIVATE_CASE'}]}});
const state=()=>({status:'ready',session_generation:1,arms:Object.fromEntries(['without','with'].map(a=>[a,{status:'ready',questions:[],approvals:[]}])) ,code_checks:{enabled:true,closed:false,running:0,arms:Object.fromEntries(['without','with'].map(a=>[a,{latest:record(a),reports:[record(a)],reports_omitted:0}]))}});
test('UI keeps both comparisons visible and disables only CI on pending question',()=>{const s=state();assert.equal(codeChecksView(s,'both',true).feedback,true);s.arms.with.status='question';s.arms.with.questions=[{}];const view=codeChecksView(s,'both',true);assert.equal(view.check,false);assert.equal(view.feedback,false);assert.deepEqual(Object.keys(view.labels),['without','with']);assert.equal(codeChecksView(s,'without',true).check,true);});
test('CI evidence records checks and bounded metadata, not output/names/native IDs',()=>{const s=state();s.code_checks.arms.with.reports[0].workspace='/SECRET/PATH';s.code_checks.arms.with.reports[0].sessionId='PRIVATE_NATIVE_ID';const safe=projectCodeChecks(s.code_checks);assert.equal(safe.arms.with.latest.summary.state,'passed');assert.equal(safe.arms.with.latest.elapsed_ms,10);assert.doesNotMatch(JSON.stringify(safe),/SECRET|PRIVATE/);assert.equal(safe.arms.with.latest.summary.public_tests.pass,2);});

test('actual Claude shell adapter supplies exactly one CI mount before results',async()=>{const fs=await import('node:fs/promises');const{sessionWorkspaceHtml}=await import('../src/session-workspace-view.mjs');const html=sessionWorkspaceHtml(await fs.readFile(new URL('../web/terminal-app.html',import.meta.url),'utf8'));assert.equal((html.match(/id="session-code-checks"/g)??[]).length,1);assert.ok(html.indexOf('id="session-code-checks"')<html.indexOf('class="results"'));assert.ok(html.includes('/session-code-checks.css'));assert.ok(html.includes('id="shared-send-controls"'));});

test('late old CI success or error cannot affect a new session panel',async t=>{
 const{mountCodeChecks}=await import('../web/session-code-checks.mjs');
 class Element{constructor(doc){this.ownerDocument=doc;this.children=[];this.listeners={};this.textContent='';this.classList={add(){}};}append(...nodes){this.children.push(...nodes);}setAttribute(){}addEventListener(name,fn){this.listeners[name]=fn;}}
 for(const failure of[false,true])await t.test(failure?'late error':'late success',async()=>{
  const doc={createElement(){return new Element(doc);}},container=new Element(doc);let resolve,reject;
  const panel=mountCodeChecks(container,{post:()=>new Promise((a,b)=>{resolve=a;reject=b;}),onState:()=>assert.fail('old response must not apply to new panel')});
  const old=state(),next=state();next.session_generation=2;panel.render(old,{connected:true});
  const feedback=container.children[3].children[1];feedback.listeners.click();assert.ok(resolve);
  panel.render(next,{connected:true});
  if(failure)reject(Error('old operation failed'));else resolve({state:old,outcome:{status:'started'}});
  await new Promise(r=>setImmediate(r));
  assert.equal(container.children[4].textContent,'');assert.equal(feedback.disabled,false);
 });
});

test('enabling CI alone never claims that checks have run',async()=>{const{projectEvidence}=await import('../src/evidence-projection.mjs');const s=state();for(const arm of['without','with']){s.code_checks.arms[arm].latest=null;s.code_checks.arms[arm].reports=[];}assert.equal(projectEvidence(s).quality.state,'not_verified');const checked=state();assert.equal(projectEvidence(checked).quality.state,'checks_recorded');});


test('unsupported platform explains the local sandbox and disables both actions without showing a pass',async()=>{
 const s=state();s.code_checks.capability='unsupported_platform';const v=codeChecksView(s,'both',true);
 assert.equal(v.check,false);assert.equal(v.feedback,false);assert.equal(v.availability,'Check code requires macOS or Linux with its supported local sandbox.');assert.equal(v.labels.with,'Unavailable');assert.equal(v.labels.without,'Unavailable');
 const{mountCodeChecks}=await import('../web/session-code-checks.mjs');
 class Element{constructor(doc){this.ownerDocument=doc;this.children=[];this.listeners={};this.textContent='';this.classList={add(){}};}append(...nodes){this.children.push(...nodes);}setAttribute(){}addEventListener(name,fn){this.listeners[name]=fn;}}
 const doc={createElement(){return new Element(doc);}},container=new Element(doc);let posts=0;const panel=mountCodeChecks(container,{post:async()=>{posts++;},onState(){}});panel.render(s,{connected:true});
 const check=container.children[3].children[0],feedback=container.children[3].children[1];assert.equal(check.disabled,true);assert.equal(feedback.disabled,true);
 assert.match(container.children[5].textContent,/requires macOS/);check.listeners.click();feedback.listeners.click();await new Promise(r=>setImmediate(r));assert.equal(posts,0);
});

test('legacy and macOS platform-only snapshots retain existing CI behavior',()=>{
 const s=state();let v=codeChecksView(s,'both',true);assert.equal(v.check,true);assert.equal(v.feedback,true);assert.equal(v.availability,'');
 s.code_checks.capability='requires_sandbox_check';v=codeChecksView(s,'both',true);assert.equal(v.check,true);assert.equal(v.feedback,true);assert.equal(v.availability,'');
});


test('Linux code-check capability describes its sandbox prerequisite without disabling settled checks',()=>{
 const s=state();s.code_checks.capability='requires_linux_sandbox_check';const v=codeChecksView(s,'both',true);
 assert.equal(v.check,true);assert.match(v.availability,/bubblewrap.*unprivileged user namespaces/);
});
