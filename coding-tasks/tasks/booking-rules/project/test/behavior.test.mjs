import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';
const dir=process.env.TASK_PROJECT_DIR??new URL('..',import.meta.url).pathname;const {createBookingService}=await import(pathToFileURL(path.resolve(dir,'src/booking.mjs')));
test('a retry does not consume a second seat',()=>{const s=createBookingService(1),first=s.reserve('one','req-1');assert.deepEqual(s.reserve('one','req-1'),first);assert.deepEqual(s.reserve('two','req-2'),{ok:false,reason:'full'})});
