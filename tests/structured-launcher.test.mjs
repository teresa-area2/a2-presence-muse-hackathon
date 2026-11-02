import test from 'node:test';import assert from 'node:assert/strict';import {buildStructuredLauncher,canonicalWorkspaceEnvironment} from '../structured-live.mjs';
test('does not silently choose a different coding task',async()=>{await assert.rejects(buildStructuredLauncher({environment:{}}),/project_task_profile_required/);});

test('canonical restarts select textbox with live calls disabled; explicit reviewed overrides stay intact',()=>{const source={HOME:'/home'};const selected=canonicalWorkspaceEnvironment(source);assert.equal(selected.A2_MUSE_PRESENCE_SOURCE,'textbox');assert.equal(selected.A2_MUSE_OP_LIVE,'0');assert.equal(selected.A2_MUSE_CAPTURE_AUTHORIZED,'0');assert.equal(canonicalWorkspaceEnvironment({A2_MUSE_CAPTURE_AUTHORIZED:'1'}).A2_MUSE_CAPTURE_AUTHORIZED,'1');assert.deepEqual(source,{HOME:'/home'});assert.equal(canonicalWorkspaceEnvironment({A2_MUSE_PRESENCE_SOURCE:'desktop'}).A2_MUSE_PRESENCE_SOURCE,'desktop');assert.equal(canonicalWorkspaceEnvironment({A2_MUSE_OP_LIVE:'1'}).A2_MUSE_OP_LIVE,'1');});


test('interactive launcher opts into the isolated native profile for both coding arms',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../structured-live.mjs',import.meta.url),'utf8');
 // Wiring guard: nativeProfile's settings and auth/reference behavior are
 // exercised independently in isolated-muse-config.test.mjs.
 assert.match(source,/createIsolatedMuseConfigs\(\{sessionDir:folder,environment:env,nativeProfile:true\}\)/);
});
