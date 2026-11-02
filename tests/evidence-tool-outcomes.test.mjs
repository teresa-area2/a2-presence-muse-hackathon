import test from 'node:test';
import assert from 'node:assert/strict';
import {EvidenceToolOutcomes} from '../src/evidence-tool-outcomes.mjs';
const scope=()=>({sessionId:'session-1',turnIds:new Set(['turn-1','turn-2'])});
const event=(over={},method='item/completed')=>({method,params:{sessionId:'session-1',item:{kind:'toolCall',turnId:'turn-1',itemId:'item-1',callId:'call-1',tool:'bash',status:'completed',revision:1,args:{command:'cat SECRET-PATH'},...over}}});
const collector=options=>new EvidenceToolOutcomes({arm:'with',scope,...options});

test('native lifecycle updates one call and deduplicates same-revision replay',()=>{
 const c=collector();c.observe(event({status:'inProgress'},'item/started'));c.observe(event({revision:2}));c.observe(event({revision:2}));
 const x=c.snapshot();assert.equal(x.tool_calls,1);assert.equal(x.rows[0].status,'completed');assert.equal(x.rows[0].revision,2);assert.equal(x.duplicate_events,1);assert.equal(x.coverage,'observed_notifications_only');assert.equal(x.rows[0].execution_verification,'not_verified');
});
test('failed tool and visible-output-only environment failure retain distinct evidence',()=>{
 const c=collector();c.observe(event({status:'failed',failureKind:'execution_error',failureReason:'ENOENT SECRET-PATH'}));
 c.observe(event({itemId:'item-2',callId:'call-2',visibleOutput:'tool failed: environment failure: managed shell sandbox is unavailable. SECRET-OUTPUT'}));
 const x=c.snapshot();assert.equal(x.native_failure_statuses,1);assert.deepEqual(x.rows[0].diagnostic_hints,['path_not_found']);assert.equal(x.rows[1].status,'completed');assert.deepEqual(x.rows[1].diagnostic_hints,['managed_sandbox_unavailable']);assert.equal(x.rows[1].diagnostic_hint_source,'visible_output_pattern');assert.equal(x.rows[1].execution_verification,'not_verified');assert.ok(!JSON.stringify(x).includes('SECRET'));
});
test('commands, paths, arbitrary failure classes, output, patches and reasoning never enter the record',()=>{
 const c=collector();c.observe(event({tool:'SECRET-PRIVATE-TOOL',failureKind:'SECRET-PRIVATE-CLASS',failureReason:'SECRET-FAILURE',visibleOutput:'SECRET-OUTPUT',patchSummary:'SECRET-PATCH',outputRef:'SECRET-REFERENCE'}));
 c.observe({method:'item/delta',params:{sessionId:'session-1',delta:'SECRET-DELTA'}});c.observe(event({kind:'reasoning',text:'SECRET-REASONING'}));
 const s=JSON.stringify(c.snapshot());assert.ok(!s.includes('SECRET'));assert.equal(c.snapshot().rows[0].tool,'other');assert.equal(c.snapshot().rows[0].failure_kind,'other');assert.match(c.snapshot().rows[0].args_sha256,/^[a-f0-9]{64}$/);
});
test('foreign sessions and unadmitted turns are excluded and make coverage uncertain',()=>{
 const c=collector();const foreign=event();foreign.params.sessionId='foreign';c.observe(foreign);c.observe(event({turnId:'foreign'}));c.observe(event());
 assert.equal(c.snapshot().tool_calls,1);assert.equal(c.snapshot().unscoped_events,1);assert.equal(c.snapshot().pending_calls,1);assert.equal(c.snapshot().coverage,'partial_or_unverified');
});
test('late events from a previously admitted turn retain their own scope',()=>{
 const c=collector();c.observe(event({turnId:'turn-2'}));c.observe(event({itemId:'older-tool',turnId:'turn-1',status:'failed'}));
 assert.equal(c.snapshot().tool_calls,2);assert.notEqual(c.snapshot().rows[0].turn_sha256,c.snapshot().rows[1].turn_sha256);
});
test('older updates cannot overwrite current evidence; same-revision conflicts flag uncertainty',()=>{
 const c=collector();c.observe(event({revision:2,status:'failed'}));c.observe(event({revision:1,status:'inProgress'}));c.observe(event({revision:2,status:'completed'}));
 assert.equal(c.snapshot().rows[0].status,'failed');assert.equal(c.snapshot().invalid_events,1);assert.equal(c.snapshot().coverage,'partial_or_unverified');
});
test('row capacity retains the first tools and reports bounded unique omissions',()=>{
 const c=collector({limit:1});c.observe(event());for(let n=0;n<140;n++){const e=event({itemId:'omitted-'+n});c.observe(e);c.observe(e);}
 const x=c.snapshot();assert.equal(x.rows.length,1);assert.equal(x.omitted_calls,128);assert.equal(x.omitted_count_is_lower_bound,true);assert.equal(x.coverage,'partial_or_unverified');
});
test('repeated invocation signatures identify loops without retaining arguments',()=>{
 const c=collector();c.observe(event());c.observe(event({itemId:'item-2',callId:'call-2'}));c.observe(event({itemId:'item-3',callId:'call-3',args:{command:'different'}}));
 const x=c.snapshot();assert.equal(x.repeated_invocations.length,1);assert.equal(x.repeated_invocations[0].count,2);assert.ok(!JSON.stringify(x).includes('SECRET-PATH'));x.rows[0].status='modified';assert.equal(c.snapshot().rows[0].status,'completed');
});
test('unknown native status and absent output remain unknown rather than a success claim',()=>{
 const c=collector();c.observe(event({status:'futureStatus'}));const x=c.snapshot();assert.equal(x.rows[0].status,'unknown');assert.equal(x.in_progress_or_unknown,1);assert.equal(x.rows[0].output_present,false);assert.equal(x.rows[0].execution_verification,'not_verified');
});
test('invalid revisions and oversized or cyclic argument values do not persist arbitrary data',()=>{
 const c=collector();c.observe(event({revision:0}));const cyclic={};cyclic.self=cyclic;c.observe(event({args:cyclic}));c.observe(event({itemId:'item-2',args:'SECRET'.repeat(50000)}));
 assert.equal(c.snapshot().invalid_events,1);assert.ok(c.snapshot().rows.every(row=>row.args_sha256===null));assert.ok(!JSON.stringify(c.snapshot()).includes('SECRET'));
});
test('no tool events stays not-observed and does not prove no tool ran',()=>{
 const c=collector();assert.equal(c.snapshot().status,'not_observed');assert.equal(c.snapshot().tool_calls,0);assert.equal(c.snapshot().coverage,'observed_notifications_only');
});

test('redacted owned-session tool frames before the start acknowledgement wait for exact turn admission',()=>{
 const state={sessionId:'session-1',turnIds:new Set()},c=collector({scope:()=>state});
 c.observe(event({status:'inProgress'},'item/started'));
 c.observe(event({revision:2,status:'failed',failureReason:'ENOENT SECRET-PATH'}));
 assert.equal(c.snapshot().tool_calls,0);assert.equal(c.snapshot().pending_calls,1);
 assert.ok(!JSON.stringify(c).includes('SECRET'));
 state.turnIds.add('turn-1');const x=c.snapshot();
 assert.equal(x.tool_calls,1);assert.equal(x.pending_calls,0);assert.equal(x.rows[0].status,'failed');assert.deepEqual(x.rows[0].diagnostic_hints,['path_not_found']);assert.equal(x.coverage,'observed_notifications_only');
});
