import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';
const dir=process.env.TASK_PROJECT_DIR??new URL('..',import.meta.url).pathname;const {importCustomers}=await import(pathToFileURL(path.resolve(dir,'src/import.mjs')));
test('valid rows are normalized while bad rows are reported',()=>{assert.deepEqual(importCustomers([{name:' Ana ',email:' ANA@EXAMPLE.ORG '},{name:'',email:'bad'}],new Set()),{accepted:[{name:'Ana',email:'ana@example.org'}],errors:[{index:1,reason:'invalid_name'}]})});
