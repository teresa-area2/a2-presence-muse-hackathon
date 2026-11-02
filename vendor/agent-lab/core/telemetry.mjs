import {labConfig} from '../config.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {normalizeCodexSession} from './codex-telemetry.mjs';
const execute=promisify(execFile);
export const ownedDescriptor=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='runId,sessionId'&&Object.values(value).every(x=>typeof x==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(x));
// The optional descriptor comes from the dispatch controller, never request IDs
// supplied by an HTTP client. Absence preserves legacy root discovery.
export async function lookupNativeSessions(host,workspace,home=os.homedir(),options={}){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['ownedSession','python'].includes(k))||
    (options.python!==undefined&&(typeof options.python!=='string'||!options.python||/[\x00-\x1f\x7f]/.test(options.python))))return {files:[],limited:false,error:'invalid_owned_session'};
 const assigned=Object.hasOwn(options,'ownedSession');
 if(assigned&&(host!=='muse'||!ownedDescriptor(options.ownedSession)))return {files:[],limited:false,error:'invalid_owned_session'};
 try{const args=[fileURLToPath(new URL('./native-session-index.py',import.meta.url)),host,workspace,home];if(assigned)args.push(JSON.stringify(options.ownedSession));const {stdout}=await execute(options.python??labConfig.python,args,{timeout:3000,maxBuffer:65536});return JSON.parse(stdout);}
 catch{return {files:[],limited:false,error:'native_index_unavailable'};}
}

const LIMIT = 8 * 1024 * 1024;
const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const number = value => Number.isFinite(value) && value >= 0 ? value : null;

// Only public text and usage counters are examined. Never retain text, inputs,
// tool results, thinking blocks or raw transcript records in the returned object.
export function summarizeTelemetry({records = [], hooks = [], workspace, arm = 'with'} = {}) {
  const messages = new Map(), users = new Set(), tools = new Set();
  let start = null, latestUser = null, latestResponse = null, first = null, completion = null, characters = 0, questions = 0, matching = 0;
  for (const record of records) {
    if (workspace && record.cwd !== workspace) continue;
    matching++;
    const at = stamp(record.timestamp);
    const message = record.message;
    if (!message || !at) continue;
    if (record.type === 'user' && typeof message.content === 'string') {
      users.add(record.uuid || at);
      if (!start || at < start) start = at;
      if (!latestUser || at > latestUser) latestUser = at;
    }
    if (record.type !== 'assistant' || !Array.isArray(message.content)) continue;
    const id = message.id || record.uuid;
    if (!id) continue;
    let item = messages.get(id);
    if (!item) messages.set(id, item = {text: new Map(), usage: {}, at});
    for (const block of message.content) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        // Native records can repeat a message. Distinct text blocks remain public
        // response segments, while repeated copies do not inflate counts.
        item.text.set(block.text, {characters: block.text.length, questions: (block.text.match(/\?/g) || []).length});
        if (!first || at < first) first = at;
        if (!latestResponse || at > latestResponse) latestResponse = at;
      }
      if (block?.type === 'tool_use' && typeof block.id === 'string') tools.add(block.id);
    }
    for (const field of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) {
      const value = number(message.usage?.[field]);
      if (value !== null) item.usage[field] = Math.max(item.usage[field] ?? 0, value);
    }
    if (message.stop_reason === 'end_turn' && (!completion || at > completion)) completion = at;
  }
  let segments = 0;
  const tokens = Object.fromEntries(['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].map(k => [k, null]));
  for (const item of messages.values()) {
    segments += item.text.size;
    for (const value of item.text.values()) { characters += value.characters; questions += value.questions; }
    for (const [key, value] of Object.entries(item.usage)) tokens[key] = (tokens[key] ?? 0) + value;
  }
  const fallbacks = {};
  let attempted = 0, eligible = 0, turns = 0;
  for (const hook of hooks) {
    // PostLLMCall observes a model response; it is not a Presence read.
    if (hook.event === 'PostLLMCall') continue;
    if (hook.event === 'UserPromptSubmit') turns++;
    if (hook.fallback_reason === 'baseline_disabled') continue;
    attempted++;
    if (hook.eligible === true) eligible++;
    else { const reason = /^[a-z_]{1,64}$/.test(hook.fallback_reason || '') ? hook.fallback_reason : 'unavailable'; fallbacks[reason] = (fallbacks[reason] || 0) + 1; }
  }
  return {
    available: matching > 0,
    state: !latestUser ? 'not_started' : completion && completion >= latestUser ? 'completed' : latestResponse && latestResponse >= latestUser ? 'running' : 'waiting_for_response',
    source: 'native_claude_metadata',
    user_turns: users.size,
    public_response_segments: segments,
    public_characters: characters,
    question_marks_proxy: questions,
    tool_calls: tools.size,
    first_user_at: start,
    first_response_at: first,
    latest_completed_at: completion,
    first_response_seconds: start && first ? Math.max(0, (Date.parse(first)-Date.parse(start))/1000) : null,
    elapsed_to_latest_completion_seconds: start && completion ? Math.max(0, (Date.parse(completion)-Date.parse(start))/1000) : null,
    tokens,
    presence: {hook_turns: turns, read_attempts: attempted, fresh_reads: eligible, eligible_reads: eligible, fallbacks, baseline_expected_zero: arm === 'without' ? attempted === 0 : null},
    limitations: ['Counts are communication proxies, not human burden.', 'Question marks are not classified approval or clarification requests.', 'Elapsed time includes user and approval waits; wait time is not separately measurable.', 'Token values are native reported counters deduplicated by message ID; null means unavailable.'],
  };
}

async function jsonLines(file,{strict=false,requireNewline=false}={}) {
  try {
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > LIMIT) return {records: [], limited: true};
    const data = await fs.readFile(file, 'utf8');
    if(requireNewline&&data&&!data.endsWith('\n'))return {records:[],limited:true,error:'native_log_unreadable'};
    const records = [];
    for (const line of data.split('\n')) { if (!line) continue; try { records.push(JSON.parse(line)); } catch {if(strict)return {records:[],limited:true,error:'native_log_unreadable'};} }
    return {records, limited: false};
  } catch(error) { return {records: [], limited: false, error:error.code==='ENOENT'?null:'native_log_unreadable'}; }
}

const scopedUuid=x=>typeof x==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(x);
const matchesScope=(row,scope)=>row?.session_id===scope.sessionId&&
  (row.run_id===scope.runId||row.run_id==null&&row.turn_id===scope.turnId)&&
  (row.turn_id==null||row.turn_id===scope.turnId);
function priorBeforeCurrent(records,sessionId,priorRun,currentRun){
  let priorLast=-1,currentFirst=Infinity,completed=false,unsafe=false;
  function visit(items,depth=0){
    if(depth>32){unsafe=true;return;}
    for(const record of items??[]){
      if(!record||typeof record!=='object')continue;
      if(Array.isArray(record.children))visit(record.children,depth+1);
      if(record.stream?.kind!=='session'||record.stream.id!==sessionId||record.payload_type!=='runtime.session')continue;
      const run=record.payload?.run_id;if(run!==priorRun&&run!==currentRun)continue;
      if(!Number.isSafeInteger(record.sequence)||record.sequence<0){unsafe=true;continue;}
      if(run===priorRun){priorLast=Math.max(priorLast,record.sequence);if(record.payload?.event?.kind==='terminal'&&record.payload.event.terminal==='completed')completed=true;}
      else currentFirst=Math.min(currentFirst,record.sequence);
    }
  }
  visit(records);
  return !unsafe&&completed&&priorLast>=0&&Number.isFinite(currentFirst)&&priorLast<currentFirst;
}

// Prior scopes are controller-supplied only after completion, and every one is
// checked again against the same owned native session before any old audit is
// discarded. A foreign or unbound row is never made harmless by this API.
export async function partitionOwnedMuseAudits({records,workspace,home,sessionIndex,ownedSession,ownedTurn,priorScopes=[],python}) {
  if(!Array.isArray(priorScopes)||priorScopes.length>64||!Array.isArray(records)||!ownedDescriptor(ownedSession))return {current:[],unbound:records?.length??0,prior:0,scopeError:'invalid_prior_scope'};
  const validTurn=scopedUuid(ownedTurn),currentScope={...ownedSession,turnId:ownedTurn};
  const seenRuns=new Set([ownedSession.runId]),seenTurns=new Set(validTurn?[ownedTurn]:[]);
  for(const scope of priorScopes){
    if(!scope||typeof scope!=='object'||Array.isArray(scope)||Object.keys(scope).sort().join(',')!=='runId,sessionId,turnId'||
       scope.sessionId!==ownedSession.sessionId||!scopedUuid(scope.runId)||!scopedUuid(scope.turnId)||seenRuns.has(scope.runId)||seenTurns.has(scope.turnId))
      return {current:[],unbound:records.length,prior:0,scopeError:'invalid_prior_scope'};
    seenRuns.add(scope.runId);seenTurns.add(scope.turnId);
    try{
      const assignment={sessionId:scope.sessionId,runId:scope.runId};
      const index=await sessionIndex('muse',workspace,home,{ownedSession:assignment,...(python!==undefined?{python}:{})});
      if(index?.error||index?.limited||index?.files?.length!==1||index.files[0].id!==scope.sessionId||index.files[0].runId!==scope.runId)throw Error();
      const read=await jsonLines(index.files[0].path,{strict:true});
      if(read.error||read.limited)throw Error();
      const {normalizeMuseSession}=await import('./muse-telemetry.mjs');
      const normalized=normalizeMuseSession(read.records,{workspace,sessionId:scope.sessionId,runId:scope.runId});
      if(normalized.scope_error||!normalized.records.some(r=>r.type==='assistant'&&r.message?.stop_reason==='end_turn')||!priorBeforeCurrent(read.records,scope.sessionId,scope.runId,ownedSession.runId))throw Error();
    }catch{return {current:[],unbound:records.length,prior:0,scopeError:'unverified_prior_scope'};}
  }
  const current=[],prior=[];let unbound=0;
  for(const row of records){
    // A current run-bound row without turn_id remains valid; turn-only rows
    // require the explicit current turn. Contradictory turn_id never wins.
    if(row?.session_id===ownedSession.sessionId&&(row.run_id===ownedSession.runId||row.run_id==null&&validTurn&&row.turn_id===ownedTurn)&&(!validTurn||row.turn_id==null||row.turn_id===ownedTurn)){current.push(row);continue;}
    if(priorScopes.some(scope=>matchesScope(row,scope))){prior.push(row);continue;}
    unbound++;
  }
  return {current,unbound,prior:prior.length,scopeError:null};
}

export function completeOwnedResponsePairs(built, modelGenerations, createdResponseIds) {
  if(!Number.isSafeInteger(modelGenerations)||modelGenerations<=0||!Array.isArray(createdResponseIds)||!Array.isArray(built?.links)||built.links.length!==modelGenerations)return false;
  const native=new Set(createdResponseIds),observed=new Set();
  if(native.size!==modelGenerations||createdResponseIds.length!==modelGenerations)return false;
  for(const link of built.links){
    if(link.linkage_status!=='linked'&&!(link.linkage_status==='unknown'&&link.reason==='missing_committed_record'))return false;
    if(typeof link.response_id!=='string'||!native.has(link.response_id)||observed.has(link.response_id))return false;
    observed.add(link.response_id);
  }
  return observed.size===native.size;
}

// Only trusted controller startup code may supply worktree paths. The native
// index and log normalizer must still verify the exact session and workspace.
export async function telemetryWorkspace(folder,arm,workspacesByArm){
  if(workspacesByArm===undefined)return path.resolve(folder,arm);
  if(!workspacesByArm||typeof workspacesByArm!=='object'||Array.isArray(workspacesByArm)||Object.keys(workspacesByArm).some(k=>!['with','without'].includes(k))||!Object.hasOwn(workspacesByArm,arm))throw Error('telemetry_workspace_invalid');
  const workspace=workspacesByArm[arm];
  if(typeof workspace!=='string'||!path.isAbsolute(workspace)||path.resolve(workspace)!==workspace||/[\x00-\x1f\x7f]/.test(workspace))throw Error('telemetry_workspace_invalid');
  try{
    const info=await fs.lstat(workspace);
    if(!info.isDirectory()||info.isSymbolicLink()||(process.getuid&&info.uid!==process.getuid())||await fs.realpath(workspace)!==workspace)throw Error();
  }catch{throw Error('telemetry_workspace_invalid');}
  return workspace;
}

export async function readTelemetry({folder, host, arms = ['without', 'with'], projectsRoot = path.join(os.homedir(), '.claude', 'projects'), home=os.homedir(), sessionIndex=lookupNativeSessions,ownedSessions,ownedTurnIds,verifiedPriorScopesByArm,python,workspacesByArm} = {}) {
  const result = {host, arms: {}, scope: 'local_metadata_only', collected_at: new Date().toISOString()};
  for (const arm of arms) {
    if (!['with', 'without'].includes(arm)) continue;
    const workspace = await telemetryWorkspace(folder,arm,workspacesByArm);
    const assigned=ownedSessions!==undefined,ownedSession=ownedSessions?.[arm];
    const audit = await jsonLines(path.join(workspace, '.presence', 'hook-events.jsonl'),{strict:assigned,requireNewline:assigned});
    let scopedAudit=assigned?(host==='muse'&&ownedDescriptor(ownedSession)?audit.records.filter(r=>r.session_id===ownedSession.sessionId&&r.run_id===ownedSession.runId):[]):audit.records;
    let records = [], limited = audit.limited, sourceFiles = 0, readError=null, nativeReads=[], extraLimits=[], userTurnsKnown=true,modelGenerations=0,committedMessages=[],createdResponseIds=[];
    if(assigned&&(host!=='muse'||!ownedDescriptor(ownedSession))){readError='invalid_owned_session';}
    else if (host === 'claude') {
      // Claude derives this exact directory from cwd. No fuzzy matching, parent
      // traversal, subagent directories or unrelated project scanning.
      const project = path.join(projectsRoot, workspace.replace(/[^a-zA-Z0-9]/g, '-'));
      try {
        const info = await fs.lstat(project);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('not a directory');
        const names = (await Promise.all((await fs.readdir(project)).filter(name => /^[a-zA-Z0-9-]+\.jsonl$/.test(name)).map(async name => ({name, modified: (await fs.lstat(path.join(project,name)).catch(()=>({mtimeMs:0}))).mtimeMs})))).sort((a,b)=>b.modified-a.modified).map(x=>x.name);
        if (names.length > 16) limited = true;
        for (const name of names.slice(0, 16)) { const read = await jsonLines(path.join(project, name)); records.push(...read.records); if(read.records.length)sourceFiles++; limited ||= read.limited; readError ||= read.error; }
      } catch(error) {if(error.code!=='ENOENT')readError='native_log_unreadable';}
    }else if(['codex','muse'].includes(host)){
      const index=assigned&&(host!=='muse'||!ownedDescriptor(ownedSession))?{files:[],limited:false,error:'invalid_owned_session'}:await sessionIndex(host,workspace,home,{...(assigned?{ownedSession}:{}),...(python!==undefined?{python}:{})});limited ||= index.limited;readError=index.error;
      if(assigned&&!readError&&((index.files??[]).length!==1||index.files[0].id!==ownedSession.sessionId||index.files[0].runId!==ownedSession.runId))readError='owned_session_mismatch';
      for(const entry of assigned&&readError?[]:index.files??[]){
        const read=await jsonLines(entry.path,{strict:assigned});limited ||= read.limited;readError ||= read.error;
        const normalized=host==='codex'?normalizeCodexSession(read.records,{workspace,sessionId:entry.id}):(await import('./muse-telemetry.mjs')).normalizeMuseSession(read.records,{workspace,sessionId:entry.id,...(assigned?{runId:ownedSession.runId}:{})});
        if(normalized.scope_error){readError=normalized.scope_error;extraLimits.push(...normalized.limitations);continue;}
        records.push(...normalized.records);nativeReads.push(...(normalized.presenceReads??[]));extraLimits.push(...(normalized.limitations??[]));for(const m of (normalized.committedMessages??[]))committedMessages.push({...m,session_id:entry.id});
        createdResponseIds.push(...(normalized.createdResponseIds??[]));
        if(normalized.user_turns_known===false)userTurnsKnown=false;
        if(Number.isSafeInteger(normalized.model_generations))modelGenerations+=normalized.model_generations;
        if(normalized.records.length)sourceFiles++;
      }
    }
    // A native hook's turn ID is not renamed to a run ID. The controller's
    // acknowledged turn-to-run mapping is used only after exact native evidence
    // has independently verified the assigned run. A contradictory run ID wins.
    const ownedTurn=ownedTurnIds?.[arm];
    let auditPartition={current:scopedAudit,unbound:audit.records.length-scopedAudit.length,prior:0,scopeError:null};
    if(assigned&&host==='muse'&&ownedDescriptor(ownedSession)&&!readError&&sourceFiles===1){
      auditPartition=await partitionOwnedMuseAudits({records:audit.records,workspace,home,sessionIndex,ownedSession,ownedTurn,priorScopes:verifiedPriorScopesByArm?.[arm]??[],python});
      scopedAudit=auditPartition.current;
    }
    result.arms[arm] = summarizeTelemetry({records, hooks: [...scopedAudit,...nativeReads], workspace, arm});
    // A verified terminal can complete an owned run even when the host did
    // not retain a user prompt display. Never invent the missing user turn.
    if(!userTurnsKnown&&records.length){result.arms[arm].user_turns=null;result.arms[arm].state=result.arms[arm].latest_completed_at?'completed':'running';}
    if(assigned){
      result.arms[arm].scope_binding=ownedDescriptor(ownedSession)?{kind:'controller_owned',session_id:ownedSession.sessionId,run_id:ownedSession.runId,verified:!readError&&sourceFiles===1}:null;
      result.arms[arm].presence.audit_scope='owned_run_only';
      const excluded=auditPartition.unbound;
      result.arms[arm].presence.unbound_audit_records_excluded=excluded;
      if(excluded||auditPartition.scopeError||audit.error||audit.limited||readError||sourceFiles!==1){
        const p=result.arms[arm].presence;p.known_scoped_read_attempts=p.read_attempts;p.read_attempts=p.fresh_reads=p.eligible_reads=p.baseline_expected_zero=null;
        extraLimits.push('Incomplete owned-session evidence or unbound hook audits; aggregate Presence reads are unknown.');
      }
    }
    result.arms[arm].source='native_'+host+'_metadata';
    result.arms[arm].limitations.push(...new Set(extraLimits));
    result.arms[arm].presence.refresh_kind=host==='muse'?(scopedAudit.some(r=>r.event==='PreLLMCall')?'native_hook_and_tool':'native_tool'):'native_hook';
    // Metadata-only guidance-to-response correlation. Raw hook identifiers
    // never enter public telemetry: only the scoped linkage status is kept.
    try{
     if(host==='muse'){
      const {buildGenerationLinks,summarizeProvenance,provenanceForPublicItem}=await import('./muse-presence-provenance.mjs');
      const ownedForProvenance=assigned&&ownedDescriptor(ownedSession)?{sessionId:ownedSession.sessionId,runId:ownedSession.runId,...(typeof ownedTurn==='string'?{turnId:ownedTurn}:{})}:null;
      if(arm==='without'){
       result.arms[arm].response_provenance={status:'unknown',reason:'baseline_no_presence',linked:0,total:0,scoped:[],items:[],limitations:['Baseline carries no Presence hooks; correlation unknown.'],qualification:'requires_live_qualification: fixtures cannot prove 1.4.13 payloads or applied guidance'};
      }else if(ownedForProvenance&&!readError&&sourceFiles===1){
       const pres=scopedAudit.filter(r=>r.event==='PreLLMCall'),posts=scopedAudit.filter(r=>r.event==='PostLLMCall');
       const built=buildGenerationLinks({pres,posts,committed:committedMessages,owned:ownedForProvenance});
       const summary=summarizeProvenance(built);
       const excludedAudits=assigned?auditPartition.unbound:0;
       // Do not publish per-item links from incomplete logs, failed/truncated
       // audits, unbound records, unfinished turns, or missing generations.
       const complete=!limited&&!audit.error&&!readError&&!auditPartition.scopeError&&sourceFiles===1&&excludedAudits===0&&result.arms[arm].state==='completed'&&completeOwnedResponsePairs(built,modelGenerations,createdResponseIds);
       const verified=complete&&summary.linked>0;
       const items=complete?built.links.map(link=>provenanceForPublicItem(built,link.message_id)).filter(item=>item.linkage_status==='linked'):[];
       result.arms[arm].response_provenance={status:verified?'linked':'unknown',reason:summary.total_generations===0?'no_scoped_generations':!complete?'incomplete_owned_evidence':verified?null:'no_committed_public_response',linked:complete?summary.linked:null,unverified:summary.unverified,unknown:summary.unknown,total:summary.total_generations,scoped:complete?summary.scoped:[],items,limitations:summary.limitations,qualification:summary.qualification};
       if(excludedAudits)result.arms[arm].response_provenance.limitations=[...result.arms[arm].response_provenance.limitations,'Unbound hook audits excluded; scoped correlation only.'];
      }else if(ownedForProvenance){
       result.arms[arm].response_provenance={status:'unknown',reason:readError??'incomplete_owned_evidence',linked:0,total:0,scoped:[],items:[],limitations:['Incomplete owned-session evidence or unverified run; correlation unknown.','requires_live_qualification: fixtures cannot prove 1.4.13 payloads or applied guidance'],qualification:'requires_live_qualification: fixtures cannot prove 1.4.13 payloads or applied guidance'};
      }else{
       result.arms[arm].response_provenance={status:'unknown',reason:'unowned_legacy_scope',linked:0,total:0,scoped:[],items:[],limitations:['No controller-owned session/run; correlation unknown.'],qualification:'requires_live_qualification: fixtures cannot prove 1.4.13 payloads or applied guidance'};
      }
     }else{
      result.arms[arm].response_provenance={status:'unknown',reason:'host_unsupported',linked:0,total:0,scoped:[],items:[],limitations:['Response correlation is integrated for Muse only.'],qualification:'requires_live_qualification: fixtures cannot prove 1.4.13 payloads or applied guidance'};
     }
    }catch{result.arms[arm].response_provenance={status:'unknown',reason:'provenance_unavailable',linked:0,total:0,scoped:[],items:[],limitations:['Provenance could not be evaluated.'],qualification:'requires_live_qualification: fixtures cannot prove 1.4.13 payloads or applied guidance'};}
    result.arms[arm].limited = limited;
    if(readError){result.arms[arm].limited=true;result.arms[arm].coverage_note='Some native metadata could not be read.';if(!records.length){result.arms[arm].state='unavailable';result.arms[arm].unavailable_reason='Native metadata is temporarily unavailable.';}}
    result.arms[arm].source_file_count = sourceFiles;
    if(host==='muse')result.arms[arm].model_generations=sourceFiles&&!readError?modelGenerations:null;
    if(limited)result.arms[arm].coverage_note = 'Partial metadata: a size or file-count safety limit was reached.';
    if (!['claude','codex','muse'].includes(host)) { result.arms[arm].available = false; result.arms[arm].state = 'unsupported'; result.arms[arm].unavailable_reason = 'Native usage telemetry is not integrated for this agent.'; }
    else if (!records.length&&!readError) result.arms[arm].unavailable_reason = limited ? 'Native log exceeds metadata safety limits.' : 'No prompt recorded in this workspace yet.';
  }
  return result;
}
