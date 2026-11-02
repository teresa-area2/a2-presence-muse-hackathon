import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {mountEvidencePackage} from '../web/evidence-package.mjs';
import {sessionWorkspaceHtml} from '../src/session-workspace-view.mjs';
const run='10000000-0000-4000-8000-000000000001';
const state=(extra={})=>({session_generation:1,evidence:{run_id:run,status:'saved',revision:3},...extra});
const receipt=()=>({ok:true,saved:{run_id:run,session_generation:1,revision:4,path:'/repo/.local/evidence-packages/example.json',sha256:'a'.repeat(64),bytes:1200}});
function fixture(save=async()=>receipt()){
 const nodes=Object.fromEntries(['export-evidence-package','evidence-package-excerpts','evidence-package-status'].map(id=>[id,{textContent:'',disabled:false,checked:false,listeners:{},addEventListener(kind,fn){this.listeners[kind]=fn;}}]));
 const panel=mountEvidencePackage({querySelector:s=>nodes[s.slice(1)]},{save});panel.configure({enabled:true});panel.render(state(),{connected:true});
 return{nodes,panel,click:()=>nodes['export-evidence-package'].listeners.click()};
}
test('the combined export is a direct diagnostics tool outside all nested details',async()=>{
 const html=sessionWorkspaceHtml(await fs.readFile(new URL('../web/terminal-app.html',import.meta.url),'utf8'));
 const stack=[],parents=[];
 for(const m of html.matchAll(/<\/?([a-z][\w-]*)\b([^>]*)>/gi)){
  const tag=m[1].toLowerCase();if(m[0].startsWith('</')){const i=stack.findLastIndex(x=>x.tag===tag);if(i>=0)stack.length=i;continue;}
  if(m[2].includes('id="export-evidence-package"'))parents.push(...stack);
  if(!['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'].includes(tag))stack.push({tag,attrs:m[2]});
 }
 assert.equal(parents.filter(p=>p.tag==='details').length,1);
 assert.ok(parents.some(p=>p.attrs.includes('id="testing-diagnostics"')));
 assert.ok(!parents.some(p=>/id="(?:session-measurement|presence-observer|session-evidence)"/.test(p.attrs)));
 assert.equal((html.match(/id="export-evidence-package"/g)??[]).length,1);
 assert.ok(!html.includes('id="evidence-export"'),'workspace has no duplicate legacy export button');
});
test('render does not export; one explicit click saves one matching package and prints its real path',async()=>{
 let calls=0,release;const f=fixture(body=>{calls++;assert.deepEqual(body,{generation:1,run_id:run,include_public_excerpts:false});return new Promise(r=>release=r);});
 assert.equal(calls,0);const pending=f.click();await f.click();assert.equal(calls,1);assert.equal(f.nodes['export-evidence-package'].disabled,true);
 release(receipt());await pending;assert.match(f.nodes['evidence-package-status'].textContent,/Saved: \/repo\/\.local\/evidence-packages\/example.json/);
 assert.equal(f.nodes['export-evidence-package'].disabled,false);
});
test('excerpts are an explicit option, not an implicit full transcript export',async()=>{
 let sent;const f=fixture(async body=>{sent=body;return receipt();});f.nodes['evidence-package-excerpts'].checked=true;await f.click();assert.equal(sent.include_public_excerpts,true);assert.deepEqual(Object.keys(sent).sort(),['generation','include_public_excerpts','run_id']);
});
test('unavailable output, disconnected or unsaved evidence cannot export',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return receipt();});
 for(const [s,connected] of [[state(),false],[state({evidence:{run_id:run,status:'unavailable',revision:3}}),true],[state({session_generation:0}),true]]){f.panel.render(s,{connected});await f.click();assert.equal(calls,0);}
 f.panel.configure({enabled:false});f.panel.render(state(),{connected:true});await f.click();assert.equal(calls,0);
});
test('a late valid receipt is labeled for its earlier pair and never borrowed by a new generation',async()=>{
 let finish;const f=fixture(()=>new Promise(r=>finish=r));const pending=f.click();f.panel.render(state({session_generation:2,evidence:{run_id:'20000000-0000-4000-8000-000000000002',status:'saved',revision:1}}),{connected:true});finish(receipt());await pending;assert.match(f.nodes['evidence-package-status'].textContent,/Saved for the earlier comparison/);
});
test('invalid receipts, stale-revision rejection and write errors never show false success or raw errors',async()=>{
 for(const invalid of [{...receipt(),saved:{...receipt().saved,run_id:'wrong'}},{...receipt(),saved:{...receipt().saved,revision:1}},{...receipt(),saved:{...receipt().saved,path:'../elsewhere'}}]){const f=fixture(async()=>invalid);await f.click();assert.match(f.nodes['evidence-package-status'].textContent,/not confirmed saved/);}
 const f=fixture(async()=>{throw Error('PRIVATE_ERROR_TOKEN');});await f.click();assert.ok(!f.nodes['evidence-package-status'].textContent.includes('PRIVATE'));
 const g=fixture(async()=>{throw Error('evidence_package_changed');});await g.click();assert.match(g.nodes['evidence-package-status'].textContent,/evidence changed before saving/);
});
test('post-publication failure shows the possible file location without claiming success or advising a blind retry',async()=>{
 const f=fixture(async()=>{const error=Error('evidence_publication_unconfirmed');error.possibly_saved={path:'/repo/.local/evidence-packages/possible.json',package_id:'30000000-0000-4000-8000-000000000003',run_id:run,session_generation:1};throw error;});
 await f.click();const text=f.nodes['evidence-package-status'].textContent;assert.match(text,/A file may exist at \/repo\/\.local\/evidence-packages\/possible.json/);assert.match(text,/durability was not confirmed/);assert.ok(!text.startsWith('Saved:'));assert.ok(!text.includes('then try again'));
});


test('changed output configuration has an actionable message and never claims success',async()=>{const f=fixture(async()=>{throw Error('evidence_output_configuration_changed');});await f.click();const text=f.nodes['evidence-package-status'].textContent;assert.match(text,/output settings changed/);assert.match(text,/comparison is preserved/);assert.ok(!text.includes('then try again'));assert.ok(!text.startsWith('Saved:'));});
