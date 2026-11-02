import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createStructuredServer} from '../structured-server.mjs';

test('the workspace serves exact inert observer assets without starting a native pair',async t=>{
 let started=0;const root=path.resolve('.');
 const server=createStructuredServer({root,labRoot:root,fixture:true,createPair:async()=>{started++;throw Error('unexpected_native_start');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.shutdown());
 const base='http://127.0.0.1:'+server.address().port;
 for(const [url,file,type]of [['/src/observer-comparison.mjs','src/observer-comparison.mjs','text/javascript'],['/presence-observer.css','web/presence-observer.css','text/css']]){
  const response=await fetch(base+url);assert.equal(response.status,200);assert.ok(response.headers.get('content-type').startsWith(type));assert.equal(await response.text(),await fs.readFile(path.join(root,file),'utf8'));assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 }
 const html=await(await fetch(base+'/')).text();assert.ok(html.includes('/presence-observer.css'));
 const observer=html.match(/<details class="card presence-observer"[\s\S]*?<div data-comparison-result/)[0];
 assert.ok(observer.includes('data-comparison-prepare>See Presence impact</button>'));
 assert.match(observer,/On request, Muse Spark 1\.3 receives the recorded exchanges, selected work files, Presence and run metrics through Meta\./);
 assert.match(observer,/Selected exchanges and code excerpts may contain private data or embedded credentials\. Secret filtering is not comprehensive\./);
 assert.equal(started,0);
});
