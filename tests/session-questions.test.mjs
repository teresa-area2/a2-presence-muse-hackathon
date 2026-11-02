import test from'node:test';import assert from'node:assert/strict';import{questionFingerprint,currentQuestion,canActOnQuestion,questionReplyReady,questionComposerRoute}from'../web/session-questions.mjs';
const prompt=()=>({userInputId:'p1',turnId:'t1',questions:[{id:'q',header:'Save',question:'Use inline review?',selection:{mode:'single'},options:[{label:'Inline'},{label:'Dialog'}]}]});
const state=()=>({status:'ready',arms:{with:{status:'question',approvals:[],questions:[prompt()]},without:{status:'ready',approvals:[]}}});
test('native question replies use the selected conversation, never Both or approval input',()=>{
 const s=state(),base={state:s,target:'with',text:'Keep inline review.',connected:true,pending:false,uncertain:false};assert.equal(questionReplyReady(base),true);assert.equal(questionReplyReady({...base,uncertain:true}),true);for(const patch of [{target:'both'},{target:'without'},{connected:false},{pending:true},{text:' '},{text:'x'.repeat(501)}])assert.equal(questionReplyReady({...base,...patch}),false);assert.equal(questionReplyReady({...base,text:'🌿'.repeat(500)}),true);s.arms.with.approvals=[{}];s.arms.with.status='approval';assert.equal(questionReplyReady(base),true);s.arms.with.questions=[];assert.equal(questionReplyReady(base),false);
});
test('stale, changed or already submitted native questions cannot be answered',()=>{
 const s=state(),p=prompt(),base={state:s,arm:'with',prompt:p,connected:true,pending:false};assert.equal(canActOnQuestion(base),true);assert.equal(canActOnQuestion({...base,pending:true}),false);s.arms.with.questions[0].busy=true;assert.equal(canActOnQuestion(base),false);delete s.arms.with.questions[0].busy;s.arms.with.questions[0].userInputId='p2';assert.equal(canActOnQuestion(base),false);s.arms.with.status='ready';assert.equal(currentQuestion(s,'with'),null);
});
test('malformed and duplicate options are not presented as actionable native questions',()=>{
 const p=prompt();assert.ok(questionFingerprint(p));p.questions[0].options.push({label:'Inline'});assert.equal(questionFingerprint(p),null);
});


test('parallel native prompts stay independently actionable and the composer requires an explicit prompt',()=>{
 const s=state(),second={...prompt(),userInputId:'p2'};s.arms.with.questions.push(second);assert.equal(currentQuestion(s,'with'),null);assert.equal(canActOnQuestion({state:s,arm:'with',prompt:second,connected:true,pending:false}),true);assert.equal(questionReplyReady({state:s,target:'with',text:'Inline',connected:true,pending:false,uncertain:false}),false);assert.equal(questionReplyReady({state:s,target:'with',userInputId:'p2',text:'Inline',connected:true,pending:false,uncertain:false}),true);
});


test('a stale reply draft never silently becomes a new instruction or answers a replacement question',()=>{
 const s=state();s.session_generation=1;const intent={arm:'with',userInputId:'p1',generation:1,fingerprint:questionFingerprint(prompt())};assert.equal(questionComposerRoute({state:s,target:'with',intent}).kind,'reply');s.arms.with.status='ready';s.arms.with.questions=[];assert.equal(questionComposerRoute({state:s,target:'with',intent}).kind,'stale_reply');s.arms.with.status='question';s.arms.with.questions=[{...prompt(),userInputId:'p2'}];assert.equal(questionComposerRoute({state:s,target:'with',intent}).kind,'stale_reply');assert.equal(questionComposerRoute({state:s,target:'with'}).prompt.userInputId,'p2');s.session_generation=2;assert.equal(questionComposerRoute({state:s,target:'with',intent}).kind,'stale_reply');
});


test('native Unicode option lengths remain usable in the client',()=>{const p=prompt();p.questions[0].options[0].description='🌿'.repeat(240);assert.ok(questionFingerprint(p));p.questions[0].options[0].description+='🌿';assert.equal(questionFingerprint(p),null);});
