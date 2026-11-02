// Guards the supported-session adapter: every exact-text replacement in
// src/session-workspace-view.mjs must still find its target in the shared
// shell files, so a copy edit cannot silently skip an adaptation.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {sessionWorkspaceHtml} from '../src/session-workspace-view.mjs';
// No no-op exceptions: every fixed adaptation must match its source.
const KNOWN_OBSOLETE=new Set();
const read=p=>fs.readFile(new URL(p,import.meta.url),'utf8');
function targets(source,fn){
 const start=source.indexOf('export function '+fn+'(');assert.ok(start>=0,fn+' not found');
 const next=source.indexOf('\nexport function ',start+1),body=source.slice(start,next<0?undefined:next);
 const found=[],re=/\.(replace|replaceAll)\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*,/g;let m;
 while((m=re.exec(body)))found.push(Function('return '+m[2])());
 return found;
}
test('every page replacement in sessionWorkspaceHtml matches the current shell HTML',async()=>{
 const [view,html]=await Promise.all([read('../src/session-workspace-view.mjs'),read('../web/terminal-app.html')]);
 const list=targets(view,'sessionWorkspaceHtml');assert.ok(list.length>5,'expected several replacements');
 const missing=list.filter(t=>!html.includes(t)&&!KNOWN_OBSOLETE.has(t));assert.deepEqual(missing,[],'unmatched replacements');
});
test('every shell replacement in sessionWorkspaceShell matches terminal-shell.mjs',async()=>{
 const [view,shell]=await Promise.all([read('../src/session-workspace-view.mjs'),read('../web/terminal-shell.mjs')]);
 const list=targets(view,'sessionWorkspaceShell');assert.ok(list.length>=1);
 const missing=list.filter(t=>!shell.includes(t));assert.deepEqual(missing,[],'unmatched replacements');
});

// Check the generated document's mounting boundaries, not CSS spelling. Hidden
// optional tools must keep their IDs while the working view stays outside them.
function elements(html){
 const found=[],stack=[],voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
 for(const match of html.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)\b([^>]*)>/gi)){
  if(!match[1])continue;const tag=match[1].toLowerCase();
  if(match[0].startsWith('</')){const i=stack.findLastIndex(e=>e.tag===tag);assert.ok(i>=0,'unbalanced closing '+tag);stack.length=i;continue;}
  const attrs=Object.fromEntries([...match[2].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].map(m=>[m[1],m[2]??'']));
  const node={tag,attrs,parents:[...stack]};found.push(node);
  if(!voids.has(tag)&&!match[0].endsWith('/>'))stack.push(node);
 }
 assert.equal(stack.length,0,'unclosed elements');return found;
}
test('utilities keep mount IDs under one closed drawer while Presence and resources stay outside',async()=>{
 const source=await read('../web/terminal-app.html'),html=sessionWorkspaceHtml(source),nodes=elements(html);
 const byId=id=>{const matches=nodes.filter(n=>n.attrs.id===id);assert.equal(matches.length,1,'unique mount '+id);return matches[0];};
 for(const node of elements(source))if(node.attrs.id)byId(node.attrs.id);
 const drawer=byId('testing-diagnostics');assert.equal(drawer.tag,'details');assert.equal(Object.hasOwn(drawer.attrs,'open'),false);
 for(const id of ['presence-observer','session-measurement','session-evidence','presence-window-audit','presence-capture','presence-hook'])assert.ok(byId(id).parents.includes(drawer),id+' remains a secondary utility');
 for(const id of ['presence-pulse','presence-policy-depth','muse-delivery','policy-history','pulse-view','usage-input-with','usage-input-without','shared','target'])assert.ok(!byId(id).parents.includes(drawer),id+' remains in the working view');
 const help=byId('about-heading');assert.ok(help.attrs.class.includes('sr-only'));assert.ok(!help.parents.includes(drawer));
 const definitions=nodes.filter(n=>n.attrs.class==='metric-help');assert.equal(definitions.length,4);
 for(const label of definitions){assert.equal(label.tag,'button');const tip=byId(label.attrs['aria-describedby']);assert.equal(tip.attrs.role,'tooltip');assert.ok(tip.parents.some(p=>p.attrs.class==='metric-definitions'));assert.ok(label.parents.some(p=>p.attrs.class==='result-metrics'));}
 const note=byId('usage-note');assert.ok(note.parents.includes(drawer));assert.ok(!note.parents.some(p=>p.attrs.class==='results'));
});

test('Pulse replay stays in its header and recency footer stays outside selected policy and history',async()=>{
 const nodes=elements(sessionWorkspaceHtml(await read('../web/terminal-app.html'))),node=id=>nodes.find(n=>n.attrs.id===id);
 const replay=node('pulse-replay'),counter=node('policy-latest'),policy=node('pulse-view-policy');
 assert.ok(replay.parents.some(p=>p.attrs.class==='pc-head'),'playback stays top-right in the header');
 assert.ok(!counter.parents.some(p=>['pc-head','pv-stage','pv-list'].includes(p.attrs.class)),'counter is a separate card footer');
 assert.ok(counter.parents.some(p=>p.attrs.class==='card policy-changes'));
 assert.ok(!replay.parents.includes(policy),'playback is outside the selected policy content');
 for(const id of ['pulse-view-policy-title','pulse-policy-depth','pulse-policy-updates','pulse-policy-conversation','pulse-view-caption'])assert.ok(node(id)?.parents.includes(policy),id+' keeps its selected-reading mount');
});
