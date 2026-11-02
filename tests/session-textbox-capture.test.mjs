import test from 'node:test';import assert from 'node:assert/strict';
import {textboxCaptureOptions} from '../web/session-app.mjs';
test('cumulative capture requires latest buffer support',()=>{
 assert.deepEqual(textboxCaptureOptions({enabled:true,latest_buffer_supported:true}),{enableLatestBuffer:true,enableCumulativeCapture:true});
});
test('missing capability stays on legacy behavior',()=>{
 for(const config of [undefined,null,{},{latest_buffer_supported:false},{latest_buffer_supported:'true'},{latest_buffer_supported:1},{enabled:true},{enabled:false,latest_buffer_supported:true},{enabled:'true',latest_buffer_supported:true}]){
  assert.deepEqual(textboxCaptureOptions(config),{enableLatestBuffer:false,enableCumulativeCapture:false});
 }
});
test('cumulative never enables alone without latest buffer',()=>{
 for(const config of [{enabled:true,latest_buffer_supported:true},{enabled:true,latest_buffer_supported:true}]){
  const options=textboxCaptureOptions(config);
  assert.equal(options.enableCumulativeCapture,options.enableLatestBuffer);
  assert.equal(options.enableCumulativeCapture,true);
 }
});
