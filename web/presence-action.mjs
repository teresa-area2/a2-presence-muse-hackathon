// Describe the current source guidance, never claim an agent followed it.
export function presenceAction(source,{review=false}={}) {
  if(review)return 'This finished run does not display a current policy.';
  if(!source || typeof source.read_at!=='string')return 'Awaiting a Presence reading.';
  if(source.eligible!==true)return 'Last source read unavailable; the intended fallback is ordinary behavior.';
  const c=source.controls;
  if(!c || !['terse','standard','full'].includes(c.response_extent) || !['conversational','self_contained'].includes(c.conversation_style) || !['send','defer'].includes(c.unsolicited_update))return 'Last source guidance is incomplete.';
  if(c.conversation_style==='self_contained')return 'Last source read: avoid optional follow-up questions.';
  return c.unsolicited_update==='defer'
    ? 'Last source read: a useful decision question may appear in the final answer; optional updates wait.'
    : 'Last source read: a useful decision question may appear in an update or answer.';
}
// Pure presentation projection: never borrow values between arms or treat
// missing/in-flight usage as a finalized zero.
const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const formatted = value => valid(value) ? new Intl.NumberFormat().format(value) : '—';
const duration = value => valid(value) ? `${Math.floor(value / 60)}m ${String(Math.floor(value % 60)).padStart(2, '0')}s` : '—';
const money = value => valid(value) ? new Intl.NumberFormat(undefined, {style:'currency', currency:'USD', maximumFractionDigits:4}).format(value) : 'Unknown';
export function comparisonStats(state = {}) {
  const result = {};
  for (const arm of ['without', 'with']) {
    let item = state.arms?.[arm];
    // Single-arm historical receipts are evidence for that arm only.
    if (!item && state.arm === arm) item = state;
    if (state.status === 'idle' && state.previousRun?.historical === true && state.previousRun.arm === arm) item = state.previousRun;
    const status = item?.status ?? 'idle', usage = item?.usage ?? {};
    const started = item?.historical === true || (typeof item?.phase === 'string' && item.phase.length > 0) || (valid(usage.model_generations) && usage.model_generations > 0);
    const observed = started && valid(usage.model_generations) && usage.model_generations > 0;
    const human = state.human_review?.arms?.[arm] ?? {};
    result[arm] = {
      status: item?.historical ? 'Previous single attempt' : !started ? 'Not started' : ['completed', 'finished', 'stopped', 'failed', 'closed'].includes(status) ? 'Recorded events' : 'In progress · observed so far',
      generations: observed ? formatted(usage.model_generations) : '—',
      input: observed ? formatted(usage.input_tokens) : '—',
      output: observed ? formatted(usage.output_tokens) : '—',
      cache: observed ? formatted(usage.cache_read_tokens) : '—',
      elapsed: started ? duration(item?.elapsed_seconds) : '—',
      approvals: started ? formatted(item?.approval_metrics?.requests) : '—',
      review: valid(human.review_window_seconds) ? `${human.review_window_seconds.toFixed(1)} s` : '—',
      effort: valid(human.effort_rating) ? `${human.effort_rating}/5` : '—',
      interruptions: formatted(human.interruption_count),
      cost: observed ? money(usage.cost_usd) : 'Unknown'
    };
  }
  return result;
}

// Transient in-page comparison only; never stored as a user preference.
export function receiptChange(previous, source) {
  const receipt=source?.received_at, controls=source?.controls, at=Date.parse(receipt);
  if (source?.eligible !== true || typeof receipt !== 'string' || !Number.isFinite(at) || !controls || typeof controls !== 'object')
    return {receipt:null, controls:null, label:'No eligible receipt to compare'};
  const values=[controls.response_extent,controls.unsolicited_update,controls.conversation_style];
  if (values.some(value=>typeof value !== 'string')) return {receipt:null, controls:null, label:'Guidance unavailable'};
  const key=JSON.stringify(values);
  if (!previous?.receipt) return {receipt, controls:key, label:'First eligible receipt in this view'};
  const prior=Date.parse(previous.receipt);
  if (at < prior) return {...previous,label:'Older receipt observed'};
  if (at === prior) return previous.label==='Older receipt observed'?{...previous,label:'Latest receipt observed'}:previous;
  return {receipt, controls:key, label:previous.controls===key?'Latest receipt · settings unchanged':'Latest receipt · settings changed'};
}

export function captureLabel(capture, readAt, now=Date.now()) {
  const state=capture?.state, reason=capture?.reason;
  if(state==='fixture') return 'Fixture · not live';
  const read=Date.parse(readAt);
  // UI heartbeat only: based on the five-second observer and 8s read timeout.
  // Never reclassifies source eligibility or changes the policy sent to Muse.
  if(!Number.isFinite(read) || !Number.isFinite(now) || now-read>20000 || read-now>5000) return 'Unconfirmed · source read not recent';
  if(state==='collecting') return 'Collecting';
  if(state==='waiting_for_input') return 'Waiting for input';
  if(state==='native_starting') return 'Starting';
  if(state==='fixture') return 'Fixture · not live';
  if(state==='off') return 'Off';
  if(state==='paused') {
    if(['native_focus_unavailable','focus_unavailable'].includes(reason)) return 'Paused · input focus unavailable';
    if(reason==='inactive_session') return 'Paused · session inactive';
    if(reason==='secure_input') return 'Paused · secure input';
    if(reason==='unsupported_field') return 'Paused · unsupported input';
    if(reason==='field_safety_unavailable') return 'Paused · input safety unavailable';
    if(reason==='poll_error') return 'Paused · capture check failed';
    return 'Paused';
  }
  return 'Unavailable';
}

// Scope-bound hook reads are evidence of a read, not model delivery or effect.
export function hookLabel(boundary) {
  const reads=boundary?.reads, eligible=boundary?.eligible;
  if (!Number.isSafeInteger(reads) || reads<0 || !Number.isSafeInteger(eligible) || eligible<0 || eligible>reads) return 'Hook evidence unavailable';
  if (!reads) return 'No hook reads recorded';
  return `${reads} reads · ${eligible} eligible · ${boundary.verification==='native_run_scoped'?'run-scoped':'scope unverified'}`;
}

export function sessionClock(state) {
  if (!state || typeof state.phase!=='string' || !state.phase || !valid(state.elapsed_seconds)) return '—';
  const seconds=Math.floor(state.elapsed_seconds);return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
}
export function armUsageLabel(state) {
  const count=state?.usage?.model_generations;
  if(!Number.isSafeInteger(count)||count<=0) return typeof state?.phase==='string'&&state.phase?'Usage unavailable':'No task sent';
  const seconds=state?.elapsed_seconds;
  const duration=valid(seconds)?` · open ${Math.floor(seconds/60)}m ${String(Math.floor(seconds%60)).padStart(2,'0')}s`:'';
  return `${formatted(count)} observed generations${duration}`;
}

// The native pilot accepts an initial task and one shared follow-up.
export function nextConversationTurn(state) {
  if(state?.phase==='implementation')return 'review-handback';
  if(state==null || state.phase==null)return 'implementation';
  return null;
}

export function shouldClearDraft(current,submitted){return typeof current==='string'&&current===submitted;}
