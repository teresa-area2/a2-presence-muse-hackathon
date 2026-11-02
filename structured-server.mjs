import {buildEvidencePackage} from './src/evidence-package.mjs';
import {createHash} from 'node:crypto';
import {sendCIFeedback} from './src/session-ci-api.mjs';
import {presentationAdvances} from './web/presentation-evidence.mjs';
// Local-only structured session interface. No model request on page load.
import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import {randomBytes,randomUUID} from 'node:crypto';import {sessionWorkspaceHtml,sessionWorkspaceShell} from './src/session-workspace-view.mjs';
import {SessionMeasurement,measurementActor} from './src/session-measurement.mjs';
import {structuredPresenceProjection} from './src/structured-presence-projection.mjs';
import {projectWindowEvents,projectMechanismLedger} from './web/session-evidence.mjs';
import {COMPARISON_MODELS,DEFAULT_COMPARISON_MODEL,requireComparisonModel} from './src/comparison-model.mjs';
import {codingTaskSelection} from './src/coding-task-selection.mjs';
import {ComparisonReportService} from './src/observer-report-service.mjs';
import {PresenceObserverService} from './src/presence-observer-service.mjs';
export function createStructuredServer({root,labRoot,createPair,observer=null,fixture=false,fixtureLabel='',taskBrief=null,taskPrompt='',onViewerChange=()=>{},startEnabled=true,evidenceStore=null,checkpointMs=5000,instanceId=randomUUID(),textboxPresence=null,textboxLiveEnabled=false,textboxSessionAuthorized=false,explainPresence=null,reviewComparison=null,taskProfiles=null,evidencePackageStore=null,evidencePackageSource=null}){
 if(evidencePackageStore!==null&&typeof evidencePackageStore?.save!=='function')throw Error('evidence_package_configuration_invalid');
 if(!path.isAbsolute(root)||!path.isAbsolute(labRoot)||typeof createPair!=='function')throw Error('structured_server_invalid');
 if(textboxPresence&&(typeof textboxPresence.capture!=='function'||typeof textboxPresence.open!=='function'||typeof textboxPresence.sourceSnapshot!=='function'))throw Error('textbox_server_invalid');if(typeof textboxLiveEnabled!=='boolean'||typeof textboxSessionAuthorized!=='boolean')throw Error('textbox_server_invalid');
 if(!Number.isSafeInteger(checkpointMs)||checkpointMs<100||checkpointMs>60000)throw Error('evidence_checkpoint_invalid');if(typeof instanceId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(instanceId))throw Error('workspace_instance_invalid');
 const tasks=codingTaskSelection(taskProfiles);let selectedTask=tasks?.select().id??null;
 const token=randomBytes(32).toString('hex'),streams=new Set(),mutations=new Set();let pair=null,opening=false,openingPromise=null,openingDone=null,openingAbort=null,rev=0,sequence=0,generation=0,error=null,measurement=new SessionMeasurement(),activeRun=null,shuttingDown=false,selectedModel=DEFAULT_COMPARISON_MODEL;
 const files=new Map([['/','web/terminal-app.html'],['/src/coding-task-catalog.mjs','src/coding-task-catalog.mjs'],['/coding-task-control.mjs','web/coding-task-control.mjs'],['/src/comparison-model.mjs','src/comparison-model.mjs'],['/comparison-model-control.mjs','web/comparison-model-control.mjs'],['/session-app.mjs','web/session-app.mjs'],['/session-code-checks.mjs','web/session-code-checks.mjs'],['/session-code-checks.css','web/session-code-checks.css'],['/workspace-controls.css','web/workspace-controls.css'],['/session-evidence.mjs','web/session-evidence.mjs'],['/evidence-package.mjs','web/evidence-package.mjs'],['/evidence-package.css','web/evidence-package.css'],['/src/observer-comparison.mjs','src/observer-comparison.mjs'],['/presence-observer.css','web/presence-observer.css'],['/session-measurement.mjs','web/session-measurement.mjs'],['/muse-delivery-view.mjs','web/muse-delivery-view.mjs'],['/terminal-shell.mjs','web/terminal-shell.mjs'],['/session-controls.mjs','web/session-controls.mjs'],['/session-questions.mjs','web/session-questions.mjs'],['/commentary-policy.mjs','web/commentary-policy.mjs'],['/presentation-decisions.mjs','web/presentation-decisions.mjs'],['/presentation-evidence.mjs','web/presentation-evidence.mjs'],['/session-panes.mjs','web/session-panes.mjs'],['/session-panes.css','web/session-panes.css'],['/terminal-task-card.mjs','web/terminal-task-card.mjs'],['/terminal-task-card.css','web/terminal-task-card.css'],['/structured-app.mjs','web/structured-app.mjs'],['/structured-app.css','web/structured-app.css'],['/terminal-app.css','web/terminal-app.css'],['/terminal-presence-view.mjs','web/terminal-presence-view.mjs'],['/terminal-usage-view.mjs','web/terminal-usage-view.mjs'],['/presence-action.mjs','web/presence-action.mjs'],['/transcript-notice.mjs','web/transcript-notice.mjs'],['/lab/pulse.mjs',path.join(labRoot,'interactive-public/pulse.mjs')],['/lab/presence-print.mjs',path.join(labRoot,'interactive-public/presence-print.mjs')],['/lab/pulse.css',path.join(labRoot,'interactive-public/pulse.css')]]);
 if(textboxPresence){files.set('/textbox-presence-client.mjs','web/textbox-presence-client.mjs');files.set('/cipher-textbox.mjs','.local/web/cipher-textbox.mjs');}
 const sourceSnapshot=()=>textboxPresence?textboxPresence.sourceSnapshot():observer?.snapshot?.();
 const textboxSnapshot=()=>textboxPresence?{...textboxPresence.snapshot(),session_authorized:textboxSessionAuthorized,history:textboxPresence.selections.map(x=>({...x})),history_omitted:textboxPresence.omitted}:null;
 const runState=ctx=>{if(ctx===activeRun&&!ctx.finalized){ctx.presence=structuredPresenceProjection(sourceSnapshot());ctx.textbox=textboxSnapshot();}return {...ctx.pair.snapshot(),code_checks:ctx.pair.codeChecks?.snapshot?.()??null,measurement:ctx.measurement.snapshot(),presence:ctx.presence,textbox:ctx.textbox??null,browser_capture_logs:[...(ctx.browserCaptureLogs?.values()??[])],browser_mechanisms:[...(ctx.browserMechanisms?.values()??[])],observer_reports:ctx.observerReports??[],observer_totals:ctx.observerTotals??null,observer_reports_omitted:ctx.observerReportsOmitted??0};};
 const checkpoint=(ctx=activeRun)=>{if(!evidenceStore||!ctx)return;try{evidenceStore.capture(ctx.id,runState(ctx));ctx.failed=false;}catch{ctx.failed=true;}};
 const save=async ctx=>{if(!evidenceStore||!ctx)return;checkpoint(ctx);if(ctx.failed)throw Error('evidence_save_failed');await evidenceStore.flush(ctx.id);};
 const observerService=new PresenceObserverService({explain:explainPresence,onFinish:async ctx=>{try{await save(ctx);}finally{broadcast(false);}}});
 const comparisonService=new ComparisonReportService({review:reviewComparison,readState:ctx=>({...runState(ctx),session_generation:ctx.generation}),onChange:()=>broadcast(false)});
 const evidenceStatus=()=>!evidenceStore?{status:'disabled',run_id:null,last_saved_at:null,revision:null,error:null}:activeRun?.failed?{...evidenceStore.status(activeRun.id),status:'unavailable',error:'evidence_save_failed'}:evidenceStore.status(activeRun?.id);
 const snapshot=()=>({...((pair&&pair.snapshot())??{status:opening?'opening':'idle',error,arms:{without:{status:'not_started'},with:{status:'not_started'}}}),presence:structuredPresenceProjection(sourceSnapshot()),code_checks:pair?.codeChecks?.snapshot?.()??null,measurement:measurement.snapshot(),evidence:evidenceStatus(),presence_observer:observerService.view(activeRun),muse_comparison:comparisonService.view(activeRun,activeRun?{...runState(activeRun),session_generation:generation}:null),textbox:textboxSnapshot(),comparison_model:selectedModel,selected_task:selectedTask,session_generation:generation,version:++sequence});
 const emit=(res,data)=>{if(res.destroyed||res.writableEnded||!res.writable)return;if(res.writableLength>1024*1024){res.end();return;}try{res.write('data: '+data+'\n\n');}catch{res.destroy();}};
 const broadcast=(persist=true)=>{if(activeRun&&!activeRun.finalized)try{comparisonService.observe(activeRun,{...pair.snapshot(),session_generation:generation});}catch{}if(textboxPresence?.session&&pair&&['stopping','closed','failed'].includes(pair.snapshot().status))textboxPresence.clear({preserveHistory:true});if(persist!==false)checkpoint();const data=JSON.stringify({type:'status',state:snapshot()});for(const res of streams)emit(res,data);server.emit('comparisonStatus');};
 observer?.on?.('change',broadcast);textboxPresence?.on?.('change',broadcast);const evidenceChanged=()=>broadcast(false);evidenceStore?.on('change',evidenceChanged);
 const heartbeat=evidenceStore?setInterval(()=>{if(activeRun&&!shuttingDown)broadcast();},checkpointMs):null;heartbeat?.unref?.();
 const server=http.createServer(async(req,res)=>{
  const host=`127.0.0.1:${server.address().port}`,origin=`http://${host}`;const json=(status,obj)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(obj));};
  if(req.headers.host!==host||(req.headers.origin&&req.headers.origin!==origin))return json(403,{error:'local_origin_required'});
  const url=new URL(req.url,origin);let finishMutation;
  try{
   if(req.method==='GET'&&files.has(url.pathname)){const file=files.get(url.pathname),body=await fs.readFile(path.isAbsolute(file)?file:path.join(root,file));const payload=url.pathname==='/'?sessionWorkspaceHtml(body.toString('utf8')):url.pathname==='/terminal-shell.mjs'?sessionWorkspaceShell(body.toString('utf8')):body;const type={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2'}[path.extname(file)];res.writeHead(200,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});return res.end(payload);}
   if(req.method==='GET'&&url.pathname==='/api/health')return json(200,{workspace_instance:instanceId,status:shuttingDown?'closing':'running'});
   if(req.method==='GET'&&url.pathname==='/api/config')return json(200,{token,workspace_instance:instanceId,evidence_package:{enabled:!!evidencePackageStore,destination:'canonical_repository_ignored_local',error:evidencePackageStore?null:'evidence_package_output_unavailable'},fixture,fixtureLabel:fixture&&typeof fixtureLabel==='string'?fixtureLabel.slice(0,200):'',taskBrief:tasks?tasks.select(selectedTask).presentation.taskBrief:taskBrief,taskPrompt:tasks?tasks.select(selectedTask).presentation.taskPrompt:taskPrompt,task_selection:tasks?.config??null,model_selection:{models:COMPARISON_MODELS,default_model:DEFAULT_COMPARISON_MODEL,matched:true},startEnabled:startEnabled===true,textbox_presence:{enabled:!!textboxPresence,live_enabled:textboxLiveEnabled,session_authorized:textboxSessionAuthorized,latest_buffer_supported:!!textboxPresence,capture_event_logging_supported:!!evidenceStore},presence_observer:{enabled:typeof explainPresence==='function',recording_enabled:!!evidenceStore,comparison_reports:typeof reviewComparison==='function'&&!!evidenceStore},state:snapshot()});
   if(req.headers['x-terminal-token']!==token)return json(403,{error:'process_token_required'});
   if(req.method==='GET'&&url.pathname==='/api/events'){streams.add(res);try{onViewerChange(streams.size);}catch{}res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','connection':'keep-alive'});const cleanup=()=>{if(!streams.delete(res))return;try{onViewerChange(streams.size);}catch{}};res.once('finish',cleanup);res.once('close',cleanup);res.on('error',()=>{cleanup();res.destroy();});emit(res,JSON.stringify({type:'status',state:snapshot()}));return;}
   if(req.method==='GET'&&url.pathname==='/api/evidence'){
    if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))return json(403,{error:'local_origin_required'});
    const g=url.searchParams.get('generation');if([...url.searchParams.keys()].some(k=>k!=='generation')||url.searchParams.getAll('generation').length!==1||!g||!/^[1-9]\d*$/.test(g)||!Number.isSafeInteger(Number(g))||Number(g)!==generation)return json(409,{error:'evidence_generation_mismatch'});
    const ctx=activeRun;if(!evidenceStore||!ctx)return json(409,{error:'evidence_not_started'});
    try{await save(ctx);const report=await evidenceStore.export(ctx.id);if(activeRun!==ctx||generation!==Number(g))return json(409,{error:'evidence_generation_mismatch'});res.setHeader('content-disposition','attachment; filename="presence-comparison-'+ctx.id+'.json"');return json(200,report);}catch{return json(503,{error:'evidence_save_failed'});}
   }
   if(req.method!=='POST'||req.headers.origin!==origin)return json(404,{error:'route_not_found'});
   const routes={'/api/evidence/package':['generation','run_id','include_public_excerpts'],'/api/start':['model','task'],'/api/submit':['text','target','actor','generation','expectedTurns'],'/api/interrupt':['target','expectedTurns','actor','generation'],'/api/ci/check':['target','actor','generation'],'/api/ci/feedback':['target','checks','actor','generation'],'/api/question':['arm','userInputId','action','answers','clarification','actor','generation'],'/api/decide':['arm','approvalId','requirementId','choiceId','reviewToken','feedback','actor','generation'],'/api/human-review':['arm','action','effort','interruptions','generation'],'/api/stop':[],'/api/presence/consent':['generation','allowed'],'/api/presence/capture':['generation','capture','observation_ended_at_ms'],'/api/capture-events':['generation','ledger'],'/api/observer/metrics':['generation','ledger'],'/api/observer/explain':['generation','ledger_id'],'/api/observer/report/preview':['generation'],'/api/observer/report':['generation','preview_id']},keys=routes[url.pathname];if(!keys)return json(404,{error:'route_not_found'});
   req.setEncoding('utf8');let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>(url.pathname==='/api/presence/capture'?262144:['/api/capture-events','/api/observer/metrics'].includes(url.pathname)?65536:24000))return json(413,{error:'request_too_large',delivery:'not_started'});}let body;try{body=JSON.parse(raw||'{}');}catch{return json(400,{error:'request_json_invalid',delivery:'not_started'});}if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!keys.includes(k)))return json(400,{error:'request_fields_invalid',delivery:'not_started'});
   if(shuttingDown)throw Error('workspace_closing');let completeMutation;const pendingMutation=new Promise(resolve=>{completeMutation=resolve;});mutations.add(pendingMutation);finishMutation=()=>{mutations.delete(pendingMutation);completeMutation();};
   if(url.pathname==='/api/evidence/package'){
    if(!evidencePackageStore)return json(503,{error:'evidence_package_output_unavailable'});
    const ctx=activeRun,epoch=rev;
    if(!evidenceStore||!ctx)return json(409,{error:'evidence_not_started'});
    if(opening||ctx.generation!==body.generation||generation!==body.generation||ctx.id!==body.run_id)return json(409,{error:'evidence_generation_mismatch'});
    if(typeof body.include_public_excerpts!=='boolean')return json(400,{error:'evidence_package_options_invalid'});
    let preparedPackage;
    try{
     await save(ctx);const checkpoint=await evidenceStore.export(ctx.id);
     if(shuttingDown||opening||activeRun!==ctx||generation!==body.generation||rev!==epoch)return json(409,{error:'evidence_generation_mismatch'});
     const capturedAt=new Date().toISOString(),view=comparisonService.view(ctx,{...runState(ctx),session_generation:ctx.generation}),digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),viewHash=digest(view);
     const assessment={run_id:ctx.id,session_generation:ctx.generation,captured_at:capturedAt,view};
     const source={...checkpoint.metadata,...evidencePackageSource};
     const pkg=buildEvidencePackage({checkpoint,assessment,identity:{run_id:ctx.id,session_generation:ctx.generation},source,includePublicExcerpts:body.include_public_excerpts,createdAt:capturedAt});
     const isCurrent=()=>!shuttingDown&&!opening&&activeRun===ctx&&generation===body.generation&&rev===epoch&&evidenceStore.status(ctx.id).revision===checkpoint.revision&&digest(comparisonService.view(ctx,{...runState(ctx),session_generation:ctx.generation}))===viewHash;
     preparedPackage=pkg;const receipt=await evidencePackageStore.save(pkg,{isCurrent});
     return json(200,{ok:true,saved:{...receipt,run_id:ctx.id,session_generation:ctx.generation,revision:checkpoint.revision},newer_evidence_available:!isCurrent()});
    }catch(error){
     if(error?.message==='evidence_publication_unconfirmed'&&error.package_id===preparedPackage?.package_id&&typeof error.published_path==='string'&&path.isAbsolute(error.published_path)&&!/[\x00-\x1f\x7f]/.test(error.published_path)&&path.basename(error.published_path)===preparedPackage.package_id+'.json'&&path.basename(path.dirname(error.published_path))==='evidence-packages')return json(503,{error:'evidence_publication_unconfirmed',possibly_saved:{path:error.published_path,package_id:error.package_id,run_id:ctx.id,session_generation:ctx.generation}});
     const outputChanged=['evidence_repository_invalid','evidence_directory_unsafe','evidence_directory_invalid'].includes(error?.message)||['ENOENT','ENOTDIR','ELOOP'].includes(error?.code);return json(error?.message==='evidence_snapshot_changed'?409:503,{error:error?.message==='evidence_snapshot_changed'?'evidence_package_changed':outputChanged?'evidence_output_configuration_changed':'evidence_package_save_failed'});
    }
   }
   if(url.pathname==='/api/start'){
    const model=requireComparisonModel(body.model);if(!tasks&&Object.hasOwn(body,'task'))throw Error('coding_task_selection_unavailable');const chosen=tasks?.select(body.task)??null;
    if(shuttingDown)throw Error('workspace_closing');if(error==='cleanup_unconfirmed')throw Error('cleanup_unconfirmed');if(startEnabled!==true)throw Error('native_approval_not_qualified');if(opening||(pair&&(pair.snapshot().status!=='closed'||pair.error==='cleanup_unconfirmed')))throw Error('pair_already_open');opening=true;let finishOpening;openingDone=new Promise(resolve=>{finishOpening=resolve;});const current=++rev;broadcast();let next,nextContext;
    try{if(pair){pair.codeChecks?.close?.();await pair.codeChecks?.wait?.();if(current!==rev)throw Error('opening_cancelled');comparisonService.cancel(activeRun);await comparisonService.wait(activeRun);observerService.cancel(activeRun);await observerService.wait(activeRun);await save(activeRun);if(activeRun)activeRun.finalized=true;pair.off('status',broadcast);pair=null;}openingAbort=new AbortController();openingPromise=Promise.resolve().then(()=>createPair({signal:openingAbort.signal,model,...(chosen?{task:chosen.id}:{})}));next=await openingPromise;if(current!==rev)throw Error('opening_cancelled');textboxPresence?.open(randomUUID());const nextMeasurement=new SessionMeasurement(),ctx=evidenceStore?{id:evidenceStore.begin(generation+1,{model,...(chosen?.metadata??{})}),generation:generation+1,model,pair:next,measurement:nextMeasurement,presence:structuredPresenceProjection(sourceSnapshot()),textbox:textboxSnapshot(),browserCaptureLogs:new Map(),browserMechanisms:new Map(),observerReports:[],failed:false,finalized:false}:null;nextContext=ctx;if(ctx&&reviewComparison&&typeof next.cleanup==='function'){const cleanup=next.cleanup;next.cleanup=async()=>{try{await comparisonService.retainFinalWork(ctx);}catch{}await cleanup.call(next);};}if(ctx)await save(ctx);if(current!==rev)throw Error('opening_cancelled');pair=next;selectedModel=model;selectedTask=chosen?.id??null;generation++;measurement=nextMeasurement;activeRun=ctx;pair.on('status',broadcast);error=null;}catch(e){textboxPresence?.clear({preserveHistory:true});let failure=e;if(next&&next!==pair){try{await next.stop();if(next.error==='cleanup_unconfirmed'||next.snapshot?.().error==='cleanup_unconfirmed')failure=Error('startup_cleanup_unconfirmed');}catch{failure=Error('startup_cleanup_unconfirmed');}if(nextContext){nextContext.finalized=true;await save(nextContext).catch(()=>{});}}error=failure?.message==='startup_cleanup_unconfirmed'?'cleanup_unconfirmed':'pair_start_failed';throw failure;}finally{opening=false;openingPromise=null;openingAbort=null;openingDone=null;finishOpening();broadcast();}
   }else if(url.pathname==='/api/stop'){comparisonService.rememberChecks(activeRun);comparisonService.cancel(activeRun);observerService.cancel(activeRun);rev++;openingAbort?.abort();textboxPresence?.clear({preserveHistory:true});if(pair)await pair.stop();await save(activeRun).catch(()=>{});broadcast();}
   else {
    if(shuttingDown)throw Error('workspace_closing');if(!pair)throw Error('pair_not_open');
    if(!Number.isSafeInteger(body.generation)||body.generation!==generation)throw Error('measurement_generation_mismatch');
    if(['/api/observer/report/preview','/api/observer/report'].includes(url.pathname)){
     const ctx=activeRun;if(!ctx||ctx.finalized||opening)throw Error('comparison_session_changed');
     const state={...runState(ctx),session_generation:generation};
     if(url.pathname.endsWith('/preview')){const preview=await comparisonService.prepare(ctx,state,{task:tasks?tasks.select(selectedTask).presentation.taskBrief:taskBrief});if(ctx!==activeRun||opening||ctx.finalized)throw Error('comparison_session_changed');return json(200,{ok:true,preview,state:snapshot()});}
     if(typeof body.preview_id!=='string'||body.preview_id.length>80)throw Error('comparison_preview_invalid');await comparisonService.generate(ctx,state,body.preview_id);broadcast(false);return json(202,{ok:true,state:snapshot()});
    }
    if(url.pathname==='/api/observer/metrics'){
     const ctx=activeRun;if(!ctx||!evidenceStore||ctx.finalized)return json(409,{error:'observer_metrics_unavailable'});
     const ledger=projectMechanismLedger(body.ledger,generation);if(!ledger)return json(400,{error:'observer_metrics_invalid'});
     const previous=ctx.browserMechanisms.get(ledger.ledger_id);
     if(previous&&(ledger.revision<previous.revision||ledger.revision===previous.revision&&JSON.stringify(ledger)!==JSON.stringify(previous)))return json(409,{error:'observer_metrics_stale'});
     if(previous&&(['held_total','released_manual','released_automatic','history_resets'].some(k=>ledger.metrics[k]<previous.metrics[k])||previous.metrics.coverage==='partial'&&ledger.metrics.coverage!=='partial'))return json(409,{error:'observer_metrics_rewound'});
     if(previous&&!presentationAdvances(previous.presentation,ledger.presentation))return json(409,{error:'observer_presentation_rewound'});
     if(!previous&&ctx.browserMechanisms.size>=16)return json(409,{error:'observer_metrics_capacity'});
     ctx.browserMechanisms.set(ledger.ledger_id,ledger);try{await save(ctx);}catch{return json(503,{error:'observer_metrics_unsaved'});}if(activeRun!==ctx||ctx.finalized||generation!==body.generation)return json(409,{error:'observer_generation_changed'});broadcast(false);return json(200,{ok:true,generation:ledger.session_generation,accepted_revision:ledger.revision,state:snapshot()});
    }
    if(url.pathname==='/api/observer/explain'){
     const ctx=activeRun;if(!ctx||ctx.finalized)return json(409,{error:'observer_session_missing'});
     const metrics=ctx.browserMechanisms.get(body.ledger_id)?.metrics;if(!metrics)return json(409,{error:'observer_metrics_missing'});
     const epoch=rev;try{await save(ctx);}catch{return json(503,{error:'observer_evidence_unsaved'});}if(shuttingDown||opening||epoch!==rev||ctx!==activeRun||generation!==body.generation||ctx.finalized)return json(409,{error:'observer_session_changed'});
     const latest=ctx.browserMechanisms.get(body.ledger_id);observerService.start(ctx,runState(ctx),latest.metrics,{ledger_id:latest.ledger_id,revision:latest.revision});broadcast(false);return json(202,{ok:true,state:snapshot()});
    }
    if(url.pathname==='/api/capture-events'){

     if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))return json(403,{error:'local_origin_required'});
     const ctx=activeRun;if(!evidenceStore||!ctx)return json(503,{error:'capture_evidence_unavailable'});if(opening||ctx.finalized||ctx.generation!==generation)return json(409,{error:'capture_generation_mismatch'});
     const rawLedger=body.ledger;if(!rawLedger||typeof rawLedger!=='object'||Array.isArray(rawLedger)||rawLedger.schema_version!==1||rawLedger.source!=='current_browser_tab'||rawLedger.session_generation!==generation||!Array.isArray(rawLedger.events)||rawLedger.events.length>200||rawLedger.rejected_events!==0)return json(400,{error:'capture_ledger_invalid'});
     const ledger=projectWindowEvents(rawLedger,generation);if(!ledger||ledger.rejected_events!==0||ledger.events.length!==rawLedger.events.length)return json(400,{error:'capture_ledger_invalid'});
     const total=ledger.events_omitted+ledger.events.length;if(!Number.isSafeInteger(total))return json(400,{error:'capture_ledger_invalid'});
     const logs=ctx.browserCaptureLogs??(ctx.browserCaptureLogs=new Map()),previous=logs.get(ledger.ledger_id);
     if(!previous&&logs.size>=16)return json(409,{error:'capture_ledger_capacity'});
     if(previous){const priorTotal=previous.events_omitted+previous.events.length;if(total<priorTotal||ledger.events_omitted<previous.events_omitted)return json(409,{error:'capture_ledger_stale'});
      const start=Math.max(previous.events_omitted,ledger.events_omitted),end=Math.min(priorTotal,total);for(let i=start;i<end;i++)if(JSON.stringify(previous.events[i-previous.events_omitted])!==JSON.stringify(ledger.events[i-ledger.events_omitted]))return json(409,{error:'capture_ledger_diverged'});
      if(total===priorTotal&&JSON.stringify(previous)!==JSON.stringify(ledger))return json(409,{error:'capture_ledger_diverged'});
     }
     logs.set(ledger.ledger_id,ledger);try{await save(ctx);}catch{return json(503,{error:'capture_evidence_save_failed'});}if(activeRun!==ctx||ctx.generation!==generation||opening)return json(409,{error:'capture_generation_mismatch'});return json(200,{ok:true,accepted_total:total});
    }
    if(url.pathname.startsWith('/api/presence/')){
     if(!textboxPresence)throw Error('textbox_presence_unavailable');if(pair.snapshot().status!=='ready')throw Error('pair_not_ready');
     if(url.pathname==='/api/presence/consent'){if(typeof body.allowed!=='boolean')throw Error('textbox_consent_invalid');if(body.allowed&&!textboxLiveEnabled)throw Error('presence_live_disabled');if(body.allowed&&!textboxSessionAuthorized)throw Error('presence_session_not_authorized');textboxPresence.setConsent(body.allowed);await save(activeRun).catch(()=>{});broadcast(false);return json(200,{ok:true,state:snapshot()});}
     if(!textboxLiveEnabled)throw Error('presence_live_disabled');if(Object.hasOwn(body,'observation_ended_at_ms')&&(!Number.isSafeInteger(body.observation_ended_at_ms)||body.observation_ended_at_ms<0))throw Error('observation_timestamp_invalid');const result=await textboxPresence.capture(body.capture,{observationEndedAtMs:body.observation_ended_at_ms??null});broadcast();return json(200,{ok:true,capture_status:result.status,state:snapshot()});
    }
    if(url.pathname==='/api/human-review'){
     const {generation:_,...action}=body;measurement.feedback(action);await save(activeRun).catch(()=>{});broadcast(false);return json(200,{ok:true,state:snapshot()});
    }
    const actor=measurementActor(body.actor),current=measurement,ctx=activeRun;
    if(url.pathname==='/api/ci/check'){
      if(!pair.codeChecks)throw Error('ci_unavailable');
      measurementActor(body.actor);
      const outcome=pair.codeChecks.check(body.target);
      await save(ctx).catch(()=>{});broadcast(false);return json(202,{ok:true,outcome,state:snapshot()});
     }
     if(url.pathname==='/api/ci/feedback'){
      if(!pair.codeChecks)throw Error('ci_unavailable');
      const selectedPair=pair,epoch=rev;
      if(textboxPresence&&body.target!=='without')textboxPresence.recordSelection('send');
      const outcome=await sendCIFeedback({service:pair.codeChecks,pair,target:body.target,checks:body.checks,isCurrent:()=>!shuttingDown&&pair===selectedPair&&generation===body.generation&&rev===epoch&&ctx===activeRun});
      // Count the explicit send action, not generated report text as human characters.
      current.submitted({actor,target:body.target,text:'',outcome});
      await save(ctx).catch(()=>{});broadcast(false);return json(200,{ok:true,outcome,state:snapshot()});
     }
     if(url.pathname==='/api/submit'){
     if(body.target!==undefined&&!['without','with','both'].includes(body.target))throw Error('shared_submission_invalid_target');
     if(textboxPresence&&body.target!=='without'){const a=pair.snapshot();if(!['with','both',undefined].includes(body.target)||a.status!=='ready'||(body.target==='both'||body.target===undefined?['without','with']:['with']).some(n=>!['ready','running','approval','question'].includes(a.arms[n]?.status)))throw Error('pair_not_ready');textboxPresence.recordSelection('send');}
     const outcome=await pair.submit(body.text,body.target,...(Object.hasOwn(body,'expectedTurns')?[{expectedTurns:body.expectedTurns}]:[]));current.submitted({actor,target:body.target,text:body.text,outcome});await save(ctx).catch(()=>{});broadcast(false);return json(200,{ok:true,outcome,state:snapshot()});
    }
    if(url.pathname==='/api/interrupt'){
     if(!['without','with','both'].includes(body.target))throw Error('turn_action_invalid');
     const outcome=await pair.interrupt(body.target,{expectedTurns:body.expectedTurns});current.interrupted({...body,actor,outcome});await save(ctx).catch(()=>{});broadcast(false);return json(200,{ok:true,outcome,state:snapshot()});
    }
    if(url.pathname==='/api/question'){
     if(!['without','with'].includes(body.arm)||typeof body.userInputId!=='string'||!['answer','clarify','cancel','engage'].includes(body.action))throw Error('question_action_invalid');
     let result;try{result=await pair.question(body.arm,{userInputId:body.userInputId,action:body.action,...(Object.hasOwn(body,'answers')?{answers:body.answers}:{}),...(Object.hasOwn(body,'clarification')?{clarification:body.clarification}:{})});}catch(e){if(body.action!=='engage'&&e.nativeDispatchAttempted===true){current.questioned({...body,actor,result:{status:'unconfirmed'}});await save(ctx).catch(()=>{});}throw e;}
     if(body.action!=='engage')current.questioned({...body,actor,result});await save(ctx).catch(()=>{});broadcast(false);return json(200,{ok:true,result,state:snapshot()});
    }
    if(!['without','with'].includes(body.arm)||typeof body.approvalId!=='string'||body.requirementId?.approvalId!==body.approvalId||!Number.isSafeInteger(body.requirementId?.sourceIndex)||body.requirementId.sourceIndex<0)throw Error('measurement_decision_invalid');
    if(!/^[a-f0-9]{64}$/.test(body.reviewToken??''))throw Error('approval_view_stale');
    const result=await pair.decide(body.arm,{approvalId:body.approvalId,requirementId:body.requirementId,choiceId:body.choiceId,reviewToken:body.reviewToken,...(Object.hasOwn(body,'feedback')?{feedback:body.feedback}:{})});current.decided({...body,actor,result});await save(ctx).catch(()=>{});broadcast(false);
   }
   return json(200,{ok:true,state:snapshot()});
  }catch(e){const reason=/^[a-z_]+$/.test(e.message)?e.message:'structured_operation_failed';return json(409,{error:reason,...(reason.startsWith('ci_')||['pair_not_ready','pair_not_open','shared_submission_invalid_target','shared_submission_not_admitted','measurement_actor_invalid','measurement_generation_mismatch','measurement_decision_invalid','approval_view_stale','approval_feedback_invalid','approval_decision_pending','approval_not_pending','turn_action_invalid','turn_action_stale','turn_action_not_admitted','native_turn_stale','native_turn_invalid','native_turn_not_ready','question_action_invalid','question_not_pending','question_scope_invalid','question_answer_invalid','user_input_unavailable','user_input_not_pending','user_input_invalid','user_input_scope_invalid','user_input_command_invalid','workspace_closing'].includes(reason)?{delivery:'not_started'}:{})});}finally{finishMutation?.();}
 });
 server.closeStreams=()=>{for(const res of streams)res.end();};
 server.isQuiescent=()=>{if(pair?.codeChecks?.snapshot?.().running)return false;if(opening||observerService.jobs.size||comparisonService.jobs.size)return false;if(!pair)return true;const s=pair.snapshot();if(s.status==='closed')return true;if(s.status!=='ready')return false;return ['without','with'].every(n=>{const a=s.arms?.[n];return a&&['ready','closed','failed'].includes(a.status)&&(a.approvals??[]).length===0;});};
 server.shutdown=async()=>{shuttingDown=true;clearInterval(heartbeat);const pendingCompletion=openingDone;comparisonService.rememberChecks(activeRun);textboxPresence?.clear({preserveHistory:true});rev++;openingAbort?.abort();let pending,unconfirmed=false;try{pending=openingPromise?await openingPromise:null;}catch(e){if(e?.message==='startup_cleanup_unconfirmed')unconfirmed=true;}for(const target of [pending&&pending!==pair?pending:null,pair]){if(!target)continue;try{await target.stop();if(target.error==='cleanup_unconfirmed'||target.snapshot?.().error==='cleanup_unconfirmed')unconfirmed=true;}catch{unconfirmed=true;}}if(pendingCompletion)await pendingCompletion;await Promise.all([...mutations]);await pair?.codeChecks?.wait?.();await comparisonService.close();await observerService.close();observer?.off?.('change',broadcast);textboxPresence?.off?.('change',broadcast);let saveFailed=false;try{await save(activeRun);await evidenceStore?.close();}catch{saveFailed=true;}evidenceStore?.off('change',evidenceChanged);server.closeStreams();await new Promise(resolve=>server.close(resolve));if(saveFailed)throw Error('evidence_save_failed');if(unconfirmed)throw Error('cleanup_unconfirmed');};return server;
}
