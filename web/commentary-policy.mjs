// Muse corrective implementation; Codex integrated strict error guards and conservative history recovery.
// Presentation-only policy for optional agent commentary (Presence arm only).
// The baseline arm never consults Presence and always shows ordinary updates.
// Only valid nonempty-text author 'Muse' / phase 'commentary' rows may be
// optional. Unknown authors/phases, explicit essential:true, mandatory:true,
// decisionNeeded:true, decision_needed:true, kind:error, kind:decision and
// errors/final answers/user rows are mandatory. Deferral reuses the existing
// consumer eligibility contract via presenceView(value,null,now).controls,
// which already defines source-read recency and valid controls. No
// receipt-age cutoff is applied: an old received_at with a recent eligible
// read remains usable.
import { presenceView } from './terminal-presence-view.mjs';

export function isOptionalCommentary(row){
  if(!row || typeof row !== 'object') return false;
  if(row.author !== 'Muse') return false;
  if(row.phase !== 'commentary') return false;
  if(typeof row.text !== 'string' || row.text.trim().length === 0) return false;
  if(row.essential === true || row.mandatory === true) return false;
  if(row.decisionNeeded === true || row.decision_needed === true) return false;
  if(['error','decision','approval'].includes(row.kind) || ['error','decision','approval'].includes(row.type) || row.error != null) return false;
  return true;
}

export function shouldDeferCommentary(presenceValue, now = Date.now()){
  try{
    const view = presenceView(presenceValue, null, now);
    return view?.controls?.unsolicited_update === 'defer';
  }catch{
    return false;
  }
}

// Stateless partition: the server list is the source of truth, so releasing
// means showing the same rows in their original order — ordering is preserved
// by construction. `revealed` is the manual "Show now" override for the
// current defer period; it never persists as a preference.
export function partitionPresenceMessages(messages, {defer, revealed} = {}){
  const rows = Array.isArray(messages) ? messages : [];
  if(!defer || revealed === true) return {visible: rows.slice(), held: []};
  const visible = [], held = [];
  for(const row of rows){
    if(isOptionalCommentary(row)) held.push(row);
    else visible.push(row);
  }
  return {visible, held};
}

export function heldNoticeText(heldCount, reading, ageLabel){
  const n = Number.isInteger(heldCount) ? heldCount : 0;
  const when = typeof ageLabel === 'string' && ageLabel ? ` · ${ageLabel}` : '';
  const scope = reading === 'Eligible guidance'
    ? 'Current eligible policy: defer optional updates'
    : reading === 'Last eligible guidance'
      ? 'Last eligible policy: defer optional updates'
      : 'Deferring optional updates';
  return `Holding ${n} optional update${n === 1 ? '' : 's'} · ${scope}${when}. Mandatory messages, approvals and answers stay visible.`;
}

// Submission acknowledgment changes delivery state, not the message identity.
// Keep the raw row for rendering; only these known human phases are equivalent.
export function messageHistoryKey(row){
  const phase = row?.author === 'You' && ['attempted','sent','steered','not_started','not_sent','unconfirmed'].includes(row.phase)
    ? 'sent' : row?.phase ?? null;
  return JSON.stringify([
    row?.author ?? null,
    phase,
    typeof row?.text === 'string' ? row.text : null,
    row?.kind ?? null,
    row?.type ?? null,
    row?.error != null,
    row?.essential === true,
    row?.mandatory === true,
    row?.decisionNeeded === true,
    row?.decision_needed === true,
  ]);
}

// Stateful projector for the current session pane. Only the 'with' arm ever
// consults Presence; any other arm shows everything without touching
// `presence` (so a throwing Presence getter never fires on baseline).
// Releasing (send/ineligible/unavailable/disconnect/expired read) and manual
// reveal mark those updates shown: they never disappear when defer resumes.
// Previously visible updates likewise stay visible; only new optional updates
// may hold. reveal() releases currently held updates, not future messages.
// Each optional occurrence also releases after120seconds of monotonic host time
// on the next render,independently of policy age/refresh. The policy remains active.
// Generation change resets transient bookkeeping. Identity is value-based
// (snapshots may be cloned), and memory is pruned to the current message set
// with a reset on rewritten/truncated history. Never mutates rows.
// metrics() is a read-only content-free accessor over this projection within
// the current generation. It counts distinct optional occurrences (duplicates
// count separately) and never counts repeated renders/clones twice.
export const MAX_OPTIONAL_HOLD_MS = 120000;
export function createCommentaryProjection({monotonicNow=()=>performance.now(),revealExistingOnMount=false}={}){
  if(typeof monotonicNow!=='function')throw Error('commentary_clock_invalid');
  let heldSince=new Map(),lastTick=null;
  let shown = new Map();
  let lastHeldKeys = [];
  let lastTotals = new Map();
  let lastGeneration;
  let lastLength = 0;
  let initialized = false;
  let lastKeys = [];
  let mHeldCurrent = 0;
  let mHeldTotal = 0;
  let mReleasedManual = 0;
  let mReleasedAutomatic = 0;
  let mHistoryResets = 0;
  let mCoverage = 'observed';
  let lastArm;
  let lastDecisions=[];

  function reset(){
    heldSince=new Map();lastTick=null;
    shown = new Map();
    lastHeldKeys = [];
    lastTotals = new Map();
    lastLength = 0;
    lastGeneration = undefined;
    initialized = false;
    lastKeys = [];
    mHeldCurrent = 0;
    mHeldTotal = 0;
    mReleasedManual = 0;
    mReleasedAutomatic = 0;
    mHistoryResets = 0;
    mCoverage = 'observed';
    lastArm = undefined;
    lastDecisions=[];
  }

  function reveal(){
    heldSince.clear();
    const manualCount = lastHeldKeys.length;
    for(const k of lastHeldKeys){
      const total = lastTotals.get(k) ?? 0;
      const cur = shown.get(k) ?? 0;
      if(total > cur) shown.set(k, total);
    }
    lastHeldKeys = [];
    if(manualCount > 0){
      mReleasedManual += manualCount;
      mHeldCurrent = Math.max(0, mHeldCurrent - manualCount);
    }
  }

  function project(messages, opts){
    const rows = Array.isArray(messages) ? messages : [];
    // Read scalar opts without touching `presence` (may be a throwing getter).
    const arm = opts?.arm;
    const generation = opts?.generation;
    const connected = opts?.connected;
    const now = opts?.now ?? Date.now();
    if(initialized && arm !== lastArm) reset();
    const wasInitialized = initialized;
    const isGenChange = initialized && generation !== lastGeneration;
    if(isGenChange){
      heldSince=new Map();lastTick=null;
      shown = new Map();
      lastHeldKeys = [];
      lastTotals = new Map();
      lastKeys = [];
      mHeldCurrent = 0;
      mHeldTotal = 0;
      mReleasedManual = 0;
      mReleasedAutomatic = 0;
      mHistoryResets = 0;
      mCoverage = 'observed';
    }
    if(initialized && !isGenChange && rows.length < lastLength){
      shown = new Map();
      lastHeldKeys = [];
      lastTotals = new Map();
    } else if(initialized && isGenChange && rows.length < lastLength){
      shown = new Map();
      lastHeldKeys = [];
      lastTotals = new Map();
    }
    const keys=rows.map(messageHistoryKey);
    const rewritten=lastKeys.length>keys.length||lastKeys.some((key,i)=>keys[i]!==key);
    const totals = new Map();
    for(const row of rows){
      if(!isOptionalCommentary(row)) continue;
      const k = messageHistoryKey(row);
      totals.set(k, (totals.get(k) ?? 0) + 1);
    }
    for(const k of [...heldSince.keys()])if(!totals.has(k))heldSince.delete(k);
    for(const k of [...shown.keys()]){
      if(!totals.has(k)) shown.delete(k);
    }
    // A reconstructed page must not hide messages that may already have been
    // seen or released. Only updates arriving after this mount may be held.
    if (!initialized && revealExistingOnMount) for (const [key,total] of totals) shown.set(key,total);
    let defer = false;
    if(arm === 'with' && connected === true){
      let presence;
      try{
        presence = opts.presence;
      }catch{
        presence = null;
      }
      try{
        defer = shouldDeferCommentary(presence, now);
      }catch{
        defer = false;
      }
    }else{
      defer = false;
    }
    if(rewritten){defer=false;heldSince.clear();}
    let tick=null;
    if(defer){try{tick=monotonicNow();}catch{tick=NaN;}if(!Number.isFinite(tick)||tick<0||lastTick!==null&&tick<lastTick){defer=false;heldSince.clear();}else lastTick=tick;}
    const prevHeldLen = lastHeldKeys.length;
    if(wasInitialized && !isGenChange && rewritten){
      mHistoryResets += 1;
      mCoverage = 'partial';
    }else if(defer && !rewritten){
      let nextHeld = 0;
      for(const [k, n] of totals){
        const s = shown.get(k) ?? 0;
        nextHeld += Math.max(0, n - s);
      }
      const newly = Math.max(0, nextHeld - prevHeldLen);
      if(newly > 0){
        mHeldTotal += newly;
      }
    }else if(!defer && !rewritten && wasInitialized && !isGenChange){
      if(prevHeldLen > 0){
        mReleasedAutomatic += prevHeldLen;
      }
    }
    if(defer){
      let expired=0;
      for(const [key,total]of totals){
        const since=heldSince.get(key)??[],already=shown.get(key)??0;
        for(let occurrence=already;occurrence<total;occurrence++){
          if(since[occurrence]===undefined)since[occurrence]=tick;
          if(tick-since[occurrence]>=MAX_OPTIONAL_HOLD_MS){shown.set(key,occurrence+1);expired++;}
        }
        for(let occurrence=0;occurrence<(shown.get(key)??0);occurrence++)delete since[occurrence];
        heldSince.set(key,since);
      }
      mReleasedAutomatic+=expired;
    }else heldSince.clear();
    let visible, held;const decisions=[];
    if(!defer){
      visible = rows.slice();
      held = [];
      rows.forEach((row,index)=>decisions.push({kind:'message',ordinal:index+1,optional:isOptionalCommentary(row),visible:true}));
      for(const [k, n] of totals) shown.set(k, n);
      lastHeldKeys = [];
      lastTotals = totals;
    }else{
      visible = [];
      held = [];
      const seen = new Map();
      for(const [index,row] of rows.entries()){
        if(!isOptionalCommentary(row)){
          decisions.push({kind:'message',ordinal:index+1,optional:false,visible:true});
          visible.push(row);
          continue;
        }
        const k = messageHistoryKey(row);
        const occ = seen.get(k) ?? 0;
        seen.set(k, occ + 1);
        const shownCount = shown.get(k) ?? 0;
        decisions.push({kind:'message',ordinal:index+1,optional:true,visible:occ<shownCount});
        if(occ < shownCount) visible.push(row);
        else held.push(row);
      }
      lastHeldKeys = held.map(messageHistoryKey);
      lastTotals = totals;
    }
    lastDecisions=decisions;
    lastKeys = keys;
    lastLength = rows.length;
    lastGeneration = generation;
    lastArm = arm;
    mHeldCurrent = held.length;
    initialized = true;
    return {visible, held, defer};
  }

  function metrics(){
    return {
      schema_version: 1,
      held_current: mHeldCurrent,
      held_total: mHeldTotal,
      released_manual: mReleasedManual,
      released_automatic: mReleasedAutomatic,
      history_resets: mHistoryResets,
      coverage: mCoverage,
    };
  }

  return {project, reveal, reset, metrics, decisions(){return lastDecisions.map(row=>({...row}));}};
}
