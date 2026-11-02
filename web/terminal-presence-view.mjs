import {captureLabel,receiptChange} from './presence-action.mjs';
export function presenceView(value,previous=null,now=Date.now()){
 const source=value?.source??null,hook=value?.hook??null;
 const read=Date.parse(source?.read_at), recent=Number.isFinite(read)&&now-read<=20000&&read-now<=5000;
 const reading=!source?.read_at?'Not read':!recent?'Last reading no longer current':source?.eligible===true?(source?.reading_freshness==='last_known'?'Last eligible guidance':source?.capture?.state==='collecting'?'Eligible guidance':'Last eligible guidance'):'Ordinary fallback';
 const capture=captureLabel(source?.capture,source?.read_at,now),change=receiptChange(previous,source);
 const candidate=source?.controls;const c=recent&&source?.eligible===true&&candidate&&['terse','standard','full'].includes(candidate.response_extent)&&['send','defer'].includes(candidate.unsolicited_update)&&['conversational','self_contained'].includes(candidate.conversation_style)?candidate:null;
 const policy=c?`${c.response_extent} response · ${c.unsolicited_update} optional updates · ${c.conversation_style.replaceAll('_',' ')}`:!recent&&source?.read_at?'Last policy no longer current':'Ordinary behavior';
 const last=hook?.last;const hookText=hook?.status==='workspace_scoped_unverified'&&last?`${hook.reads} hook reads · last ${last.eligible?'eligible':'fallback'} · session link unverified`:'No verified hook evidence';
 return {reading,capture,change,policy,controls:c,hookText};
}

// Receipt age is distinct from how recently the local source was read.
export function receiptAgeLabel(source,now=Date.now()){
 const stamp=Date.parse(source?.received_at);if(!Number.isFinite(stamp)||!Number.isFinite(now))return 'No receipt';const age=Math.floor((now-stamp)/1000);if(age<0)return 'Receipt time unconfirmed';if(age<60)return `Receipt ${age}s ago`;const minutes=Math.floor(age/60);return `Receipt ${minutes}m ${age%60}s ago`;
}

// Explain capture status without changing source eligibility or policy.
export function captureHint(source){
 const c=source?.capture;if(!source?.read_at)return 'Waiting for a confirmed capture status.';
 if(c?.state==='collecting')return 'Capture is active in a supported field.';
 if(c?.state==='waiting_for_input')return 'Waiting for normal input in a supported field.';
 if(c?.state==='paused'){if(c.reason==='secure_input')return 'Capture pauses while secure input is active.';if(c.reason==='inactive_session')return 'Return to the Mac and use a supported editor field.';if(['unsupported_field','native_focus_unavailable','focus_unavailable','focus_changed','field_safety_unavailable'].includes(c.reason))return 'Focus a supported editor field; capture resumes when safe.';return 'Capture is paused; the last guidance may be older.';}
 if(c?.state==='off')return 'Capture is off; check the Presence runtime.';
 return 'Capture status is unconfirmed.';
}

// The last request outcome is historical. Only a known positive remaining delay
// establishes a currently active wait; an ordinary cadence delay is not a 429.
export function textboxRateLimit(textbox){
 if(textbox?.status!=='backoff')return null;
 const delay=textbox.refresh_after_ms,known=typeof delay==='number'&&Number.isFinite(delay)&&delay>=0;
 return{active:known?delay>0:null,seconds:known?Math.ceil(delay/1000):null};
}
function textboxSourceCopy(textbox,{connected=true,liveEnabled=true,current=true,localCapture=null}={}){
 if(!connected)return{connection:'The workspace connection is lost; textbox readings cannot be confirmed.',help:'Textbox capture pauses while disconnected; it can resume after the same session is verified.'};
 if(!liveEnabled)return{connection:'Textbox Presence live calls are disabled.',help:'Textbox capture is disabled; no timing metadata is being sent.'};
 if(textbox?.status==='access_rejected')return{connection:'Textbox Presence access was rejected; no fresh reading is available.',help:'Textbox capture is stopped because service access was rejected.'};
 if(textbox?.consent_revoked===true)return{connection:'Textbox capture is stopped for this session.',help:'Use Stop, then Open sessions to begin a new capture session.'};
 if(textbox?.consented!==true)return{connection:textbox?.session_authorized===true?'Open sessions to enable textbox Presence.':'Textbox capture is not authorized for this session.',help:'Focus begins a typing window; blur, Send or Enter ends it. Only textbox timing metadata is sent.'};
 if(localCapture==='paused')return{connection:'Textbox capture is paused; no new timing batches are being sent.',help:'Capture must be active before typing can refresh OP. Explicit Stop or revocation requires a new session.'};
 if(localCapture==='starting')return{connection:'Textbox capture is reconnecting to the authorized session.',help:'Unused typing from the interrupted capture is discarded; no batch is replayed.'};
 if(textbox?.status==='unavailable')return{connection:textbox.selected===true&&current?'Latest OP refresh failed; the previous reading remains eligible.':'Latest OP refresh failed; no current reading is available.',help:'The service did not provide a usable new reading. A later typing observation may refresh it.'};
 const limit=textboxRateLimit(textbox);
 if(limit){const wait=limit.active===true?'retry in '+limit.seconds+'s':limit.active===false?'retry delay has elapsed':'retry timing is unconfirmed';return{connection:'Last OP refresh was rate limited; '+wait+'. '+(textbox.selected===true&&current?'The previous reading remains eligible.':'No current reading is available.'),help:limit.active===false?'A new typing observation can refresh OP; the earlier attempted sample is not replayed.':'No attempted sample is replayed; later samples respect the service backoff.'};}
 if(!current)return{connection:'The textbox source snapshot is no longer current.',help:'A current source snapshot is needed before guidance availability can be confirmed.'};
 if(textbox?.selected===true){const retained=textbox.guidance_lifetime==='active_session'&&textbox.reading_freshness==='last_known';const age=typeof textbox.age_ms==='number'&&Number.isFinite(textbox.age_ms)&&textbox.age_ms>=0?Math.floor(textbox.age_ms/1000)+'s':null,stamp=Date.parse(textbox.received_at),time=Number.isFinite(stamp)?new Date(stamp).toLocaleTimeString('en-GB',{hour12:false}):null;return{connection:time?(retained?'Using last accepted OP policy from ':'Latest OP receipt at ')+time+(age?' is '+age+' old.':'; age is unconfirmed.'):age?'Textbox guidance is available; its last reported age is '+age+'.':'Textbox guidance is available; its age is unconfirmed.',help:'A typing window ends on blur, Send or Enter; a new receipt may return the same policy.'};}
 if(textbox?.refreshing===true)return{connection:'Textbox guidance is refreshing; no fresh reading is available yet.',help:'Typing metadata is refreshing asynchronously; sending a message does not wait for it.'};
 if(textbox?.status==='waiting_for_input')return{connection:'Textbox Presence is waiting for normal typing in the message box.',help:'Type normally here; blur, Send or Enter finishes the typing window and refreshes asynchronously.'};
 return{connection:'No fresh textbox reading is available; waiting for new typing.',help:'Only typing in this message box refreshes OP. Policy values need not change at each refresh; Stop or revocation ends guidance use.'};
}


// Only closed consumer statuses cross this display boundary; no timing payload,
// capture text or private inference data is consumed here.
export function textboxCaptureLabel(observation,{connected=true,localCapture=null,liveEnabled=true}={}){
 if(!connected)return 'Textbox capture disconnected.';
 if(!liveEnabled)return 'Textbox capture disabled.';
 if(localCapture==='paused'||localCapture==='closed')return 'Textbox capture paused.';
 if(observation?.cumulative_capture==='capture_gap')return 'Capture started late; this typing window is skipped until Send, Enter or blur.';
 if(observation?.cumulative_capture==='unavailable')return 'Cumulative capture unavailable.';
 if(localCapture==='starting')return 'Textbox capture starting.';
 if(observation?.window==='open'){const interim={queued:'a sample is waiting for OP',in_flight:'OP refresh pending',unavailable:'OP refresh unavailable',discarded_cooldown:'sample not submitted during cooldown',expired:'waiting sample expired',access_rejected:'OP access rejected'};const phase=Object.hasOwn(interim,observation.last_submission)?'; '+interim[observation.last_submission]:'';return observation?.cumulative_capture==='interim_exhausted'?'Typing window open; interim snapshots used; the final snapshot is reserved'+phase+'.':'Typing window open'+phase+'; blur, Send or Enter finishes it.';}
 if(observation?.window!=='closed')return 'Textbox window status not observed.';
 const labels={queued:'Typing sample waiting for OP; a newer sample replaces it.',expired:'Waiting typing sample expired without being sent.',in_flight:'Typing window ended; OP refresh pending.',pending:'Typing window ended; submission pending.',complete:'Typing window ended; OP refresh completed.',discarded_cooldown:'Typing window ended during OP cooldown; it was not submitted.',discarded_in_flight:'Typing window ended while OP was busy; it was not submitted.',not_submitted:'Typing window ended without a submitted sample.',invalid:'Typing window was rejected before submission.',unavailable:'Typing window ended; OP refresh unavailable.',access_rejected:'OP access was rejected; capture is stopped.',cancelled:'Typing-window refresh cancelled.',unconfirmed:'Typing-window submission is unconfirmed.',discarded:'Typing-window result discarded.',discarded_consent:'Typing window discarded because capture authorization ended.'};
 let label=Object.hasOwn(labels,observation.last_submission)?labels[observation.last_submission]:null;
 if(!label)label=observation.last_window==='empty'?'Typing window ended without any completed typing.':observation.last_window==='discarded_incomplete'?'Incomplete typing window discarded.':observation.last_window==='discarded'?'Typing window discarded.':'Focus the message box to start a typing window.';
 if(observation.last_window==='completed_partial')label=label.replace(/\.$/,'')+'; only completed key pairs were retained.';
 return label;
}
export function textboxPresenceCopy(textbox,options={}){
 const out=textboxSourceCopy(textbox,options),active=options.connected!==false&&options.liveEnabled!==false&&textbox?.consented===true&&!textbox.consent_revoked&&textbox.status!=='access_rejected'&&!['paused','starting','closed'].includes(options.localCapture);
 if(active&&options.current!==false&&textbox.selected===true&&['accepted','duplicate'].includes(textbox.last_receipt)){
  const changes={first:'first policy received',unchanged:'policy unchanged',changed:'policy changed'},change=textbox.last_receipt==='duplicate'?'duplicate receipt; reading age unchanged':Object.hasOwn(changes,textbox.policy_change)?changes[textbox.policy_change]:null;
  if(change)out.connection=out.connection.replace(/\.$/,'')+'; '+change+'.';
 }
 if(active&&options.current!==false&&textbox.selected===true&&typeof textbox.observation_age_ms==='number'&&Number.isFinite(textbox.observation_age_ms)&&textbox.observation_age_ms>=0)out.connection=out.connection.replace(/\.$/,'')+'; typing observation is '+Math.floor(textbox.observation_age_ms/1000)+'s old.';
 if(active&&options.observation){
  const observation=options.observation;
  out.help=textboxCaptureLabel(observation,options);
  const phases={queued:'Typing sample waiting for OP',expired:'Waiting typing sample expired',in_flight:'OP refresh pending',pending:'Window ended; submission pending',complete:'OP refresh completed',discarded_cooldown:'Window not submitted: OP cooldown',discarded_in_flight:'Window not submitted: OP busy',not_submitted:'Window not submitted',invalid:'Window rejected before submission',unavailable:'OP refresh unavailable',cancelled:'OP refresh cancelled',unconfirmed:'Submission unconfirmed'};
  const phase=observation.window==='open'?'Typing window open':observation.window==='closed'&&Object.hasOwn(phases,observation.last_submission)?phases[observation.last_submission]:null;
  // The shared shell hides small help at narrow widths. Keep the active phase
  // in its existing visible status span; full detail stays in help/tooltip.
  if(phase)out.connection=phase+'; '+out.connection.charAt(0).toLowerCase()+out.connection.slice(1);
 }
 return out;
}

// Receipt history is source metadata. It never establishes native delivery.
const FIELDS = ['response_extent', 'unsolicited_update', 'conversation_style'];
const SCALES = [['terse', 'standard', 'full'], ['send', 'defer'], ['self_contained', 'conversational']];
const LABELS = ['Depth', 'Updates', 'Conversation'];
const ORDINARY = ['standard', 'send', 'conversational'];
const MAX = 200;
const uuid = x => typeof x === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const count = x => Number.isSafeInteger(x) && x >= 0 ? x : null;
const time = x => typeof x === 'string' && x.length <= 40 && /^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(x) && Number.isFinite(Date.parse(x)) ? new Date(x).toISOString() : null;
const label = x => x.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());

// These are artistic policy bands, never reconstructed readiness/flow/stability.
// Versioned seed makes each reading identical in the header, replay and reload.
const PULSE_BANDS = [[[.2, .3], [.4, .6], [.7, .8]], [[.2, .3], [.7, .8]], [[.2, .3], [.7, .8]]];
export function readingPulseValues(row) {
  if (!uuid(row?.reading_id) || !FIELDS.every((key, i) => SCALES[i].includes(row.controls?.[key]))) return null;
  return FIELDS.map((key, axis) => {
    let hash = 2166136261;
    for (const character of `policy-pulse-v1:${row.reading_id}:${key}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
    const [low, high] = PULSE_BANDS[axis][SCALES[axis].indexOf(row.controls[key])];
    return low + (high - low) * (hash / 4294967295);
  });
}

const loadPulseAnimator = () => import('/lab/pulse.mjs').then(x => x.PresencePrintAnimator);
export function createReadingPulseRenderer(root, {loadAnimator = loadPulseAnimator} = {}) {
  let animator = null, loading = null, signature = null, revision = 0, closed = false;
  return {async update(row) {
    if (closed) return;
    const values = readingPulseValues(row), key = JSON.stringify([values ? row.reading_id : null, values]);
    if (signature === key) return;
    signature = key; const current = ++revision;
    root.dataset.available = String(!!values);
    // CSS supplies static idle rings. Keep an existing animator mount intact
    // across fallback so later eligible guidance reuses the animator lifecycle.
    if (!values && !animator) {root.innerHTML = ''; return;}
    try {
      loading ??= loadAnimator(); const Animator = await loading;
      if (closed || current !== revision || !Animator) return;
      animator ??= new Animator(root);
      if (values) {animator.update(values); animator.setActive(true);}
      else {animator.clear(); animator.setActive(false);}
      // The pinned artwork's default SVG label names RFS numbers. This display
      // intentionally exposes only the exact policy and an illustrative shape.
      const svg = root.querySelector?.('svg');
      if (svg) {svg.setAttribute('aria-label', 'Illustrative policy-derived Pulse'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');}
    } catch {/* Source text remains usable when the artwork cannot load. */}
  }, close() {closed = true; revision++; animator?.close?.();}};
}

export function mountReadingPulse(element, options = {}) {
  element.classList.add('presence-pulse');
  const art = element.ownerDocument.createElement('div'); art.className = 'pulse-art'; art.setAttribute('aria-hidden', 'true');
  element.replaceChildren(art); element.setAttribute('role', 'img');
  const renderer = createReadingPulseRenderer(art, options);
  return {update(row) {
    const available = !!readingPulseValues(row); element.dataset.available = String(available);
    element.setAttribute('aria-label', available ? 'Illustrative Pulse from the current collaboration policy; variation is decorative, not measured RFS.' : 'No current Presence guidance');
    return renderer.update(row);
  }, close() {renderer.close();}};
}

// Extrapolate both source ages between backend snapshots. Delayed samples must
// not acquire a new freshness lifetime merely because their API receipt is new.
export function createTextboxReadingClock({now = Date.now, monotonicNow = () => performance.now()} = {}) {
  let snapshot = null, anchoredAt = null, receiptAnchor = null, observationAnchor = null, refreshAnchor = null, cycle = null, lastTick = null;
  const finiteAge = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  const refreshCycle = textbox => {
    const attempt = Array.isArray(textbox?.attempt_history) ? textbox.attempt_history.findLast(row => row?.kind === 'http' && finiteAge(row.end_wall_ms)) : null;
    return attempt ? JSON.stringify([attempt.start_wall_ms, attempt.end_wall_ms, attempt.duration_ms, attempt.cooldown_ms]) : null;
  };
  return textbox => {
    let tick; try { tick = monotonicNow(); } catch { tick = NaN; }
    // Check before re-anchoring a replacement snapshot. A regressed display
    // clock must never turn an older accepted reading into a fresh observation.
    if (!Number.isFinite(tick) || tick < 0 || lastTick !== null && tick < lastTick)
      return {current:false,receiptAge:NaN,observationAge:null,refreshAfterMs:null,readingFreshness:'unavailable'};
    lastTick = tick;
    if (snapshot !== textbox) {
      const elapsed = tick - anchoredAt, sameReading = uuid(textbox?.reading_id) && textbox.reading_id === snapshot?.reading_id;
      const nextCycle = refreshCycle(textbox);
      const receipt = finiteAge(textbox?.age_ms) ? textbox.age_ms : now() - Date.parse(textbox?.received_at);
      const observation = textbox?.observation_age_ms == null ? null : finiteAge(textbox.observation_age_ms) ? textbox.observation_age_ms : NaN;
      // A delayed snapshot cannot make the same reading younger, or rewind the
      // same known refresh cycle. New attempts (including longer backoff) reset it.
      receiptAnchor = sameReading && finiteAge(elapsed) && finiteAge(receiptAnchor) && finiteAge(receipt) ? Math.max(receipt, receiptAnchor + elapsed) : receipt;
      observationAnchor = sameReading && finiteAge(elapsed) && finiteAge(observationAnchor) && finiteAge(observation) ? Math.max(observation, observationAnchor + elapsed) : observation;
      const extended = finiteAge(textbox?.refresh_after_ms) && finiteAge(snapshot?.refresh_after_ms) && textbox.refresh_after_ms > snapshot.refresh_after_ms;
      refreshAnchor = !extended && nextCycle !== null && nextCycle === cycle && finiteAge(elapsed) && finiteAge(refreshAnchor) && finiteAge(textbox?.refresh_after_ms) ? Math.min(textbox.refresh_after_ms, Math.max(0, refreshAnchor - elapsed)) : textbox?.refresh_after_ms;
      snapshot = textbox; anchoredAt = tick; cycle = nextCycle;
    }
    const elapsed = tick - anchoredAt;
    const receiptAge = finiteAge(textbox?.age_ms) ? receiptAnchor + elapsed : Math.max(receiptAnchor + elapsed, now() - Date.parse(textbox?.received_at));
    const observationAge = observationAnchor === null ? null : observationAnchor + elapsed;
    const limit = textbox?.freshness_limit_ms;
    const agesValid = (textbox?.age_ms == null || finiteAge(textbox.age_ms)) && finiteAge(receiptAge) && (observationAge === null || finiteAge(observationAge));
    const fresh = (textbox?.guidance_lifetime !== 'active_session' || observationAge !== null) && finiteAge(limit) && agesValid && receiptAge <= limit && (observationAge === null || observationAge <= limit);
    const retained = textbox?.guidance_lifetime === 'active_session' && ['fresh','last_known'].includes(textbox?.reading_freshness);
    const current = Number.isFinite(elapsed) && elapsed >= 0 && textbox?.consented === true && !textbox.consent_revoked
      && textbox?.status !== 'access_rejected' && textbox?.selected === true && uuid(textbox.reading_id)
      && finiteAge(limit) && agesValid && (retained || fresh);
    const refreshAfterMs = finiteAge(refreshAnchor) && finiteAge(elapsed) ? Math.max(0,refreshAnchor-elapsed) : null;
    return {current, receiptAge, observationAge, refreshAfterMs, readingFreshness:current?(fresh?'fresh':'last_known'):'unavailable'};
  };
}

export function currentTextboxDisplay(state, clock) {
  if (!state?.textbox) return state;
  const age = clock(state.textbox), textbox = {...state.textbox, age_ms: age.receiptAge, observation_age_ms: age.observationAge, refresh_after_ms: age.refreshAfterMs};
  if (textbox.guidance_lifetime === 'active_session') textbox.reading_freshness = age.readingFreshness;
  const presence = textbox.guidance_lifetime === 'active_session' && state.presence ? {...state.presence, source:{...state.presence.source,reading_freshness:age.readingFreshness}} : state.presence;
  if (age.current) return {...state, textbox, presence};
  return {...state, textbox: {...textbox, selected: false}, presence: {...presence,
    source: {...presence?.source, eligible: false, controls: null, fallback_reason: 'source_ineligible'}}};
}

// Scroll the history container only; never move the conversation/page viewport.
export function revealReadingRow(list, row) {
  if (!row || !list?.getBoundingClientRect || !row.getBoundingClientRect || !(list.clientHeight > 0)) return;
  const viewport = list.getBoundingClientRect(), bounds = row.getBoundingClientRect(), top = viewport.top + (list.clientTop || 0), bottom = top + list.clientHeight;
  const delta = bounds.top < top ? bounds.top - top : bounds.bottom > bottom ? bounds.bottom - bottom : 0;
  if (!delta) return;
  const next = Math.max(0, Math.min(list.scrollHeight - list.clientHeight, list.scrollTop + delta));
  const reduced = list.ownerDocument?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (list.scrollTo) list.scrollTo({top: next, behavior: reduced ? 'auto' : 'smooth'});
  else list.scrollTop = next;
}

export function normalizePresenceReadings(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set(), rows = [];
  for (const row of raw.slice(-MAX)) {
    if (!row || !uuid(row.reading_id) || seen.has(row.reading_id)) continue;
    const received_at = time(row.received_at), generated_at = time(row.generated_at);
    if (!received_at || !generated_at || !FIELDS.every((key, i) => SCALES[i].includes(row.controls?.[key]))) continue;
    seen.add(row.reading_id);
    rows.push({reading_id: row.reading_id, received_at, generated_at,
      controls: Object.fromEntries(FIELDS.map(key => [key, row.controls[key]])),
      policy_change: ['first', 'unchanged', 'changed'].includes(row.policy_change) ? row.policy_change : 'unknown'});
  }
  return rows;
}

export function readingPolicySummary(row, previous = null) {
  if (row.policy_change === 'unchanged') return 'Policy unchanged';
  if (row.policy_change === 'first') return 'First policy';
  const changed = previous ? FIELDS.flatMap((key, i) => row.controls[key] !== previous.controls[key]
    ? [`${LABELS[i]} ${label(previous.controls[key])} → ${label(row.controls[key])}`] : []) : [];
  return changed.length ? changed.join(' · ') : row.policy_change === 'changed' ? 'Policy changed' : 'Policy comparison unavailable';
}

export function createReadingHistory() {
  let generation = null, observed = [];
  return {update(state) {
    if (count(state?.session_generation) !== null && generation !== state.session_generation) {
      generation = state.session_generation; observed = [];
    }
    const textbox = state?.textbox ?? {};
    if (Array.isArray(textbox.readings)) return {rows: normalizePresenceReadings(textbox.readings),
      omitted: count(textbox.readings_omitted), coverage: 'session', generation};
    // Compatibility with a running older backend: do not invent missed readings.
    const row = normalizePresenceReadings([{...textbox}])[0];
    if (row && !observed.some(x => x.reading_id === row.reading_id)) {
      observed.push(row); observed = observed.slice(-MAX);
    }
    return {rows: observed.map(x => ({...x, controls: {...x.controls}})), omitted: null, coverage: 'observed', generation};
  }};
}

// Display the selected reading, independent of the live header or Muse delivery.
// Changed fields compare with the previous reading in the recorded timeline.
export function renderReadingPolicyCard(document, controls, previous = null, {replay = false} = {}) {
  const valid = value => value && FIELDS.every((field, i) => SCALES[i].includes(value[field]));
  const current = valid(controls) ? controls : null, prior = valid(previous) ? previous : null;
  const title = document.getElementById('pulse-view-policy-title');
  if (title) title.textContent = current ? (replay ? 'Replayed policy' : 'Current policy') : 'No current policy';
  const card = document.getElementById('pulse-view-policy');
  if (card) card.dataset.state = current ? (replay ? 'replay' : 'current') : 'fallback';
  const rows = [['depth','response_extent',['terse','standard','full']], ['updates','unsolicited_update',['defer','send']], ['conversation','conversation_style',['self_contained','conversational']]];
  for (const [index, [name, field, scale]] of rows.entries()) {
    const node = document.getElementById('pulse-policy-' + name); if (!node) continue;
    const changed = !!current && !!prior && current[field] !== prior[field];
    const value = current ? label(current[field]) : '—';
    const description = LABELS[index] + ': ' + (current ? value : 'unavailable') + (changed ? '. Changed from ' + label(prior[field]) + '.' : '');
    node.textContent = value; node.setAttribute('aria-label', description);
    const row = node.closest?.('.pv-policy-row');
    if (row) {
      row.dataset.changed = String(changed); row.title = description;
      if (current) row.dataset.level = String(scale.indexOf(current[field]) + 1);
      else delete row.dataset.level;
    }
  }
}

export function mountReadingHistory(document, {loadAnimator = loadPulseAnimator, now = Date.now, monotonicNow = () => performance.now(),
  setTimer = setTimeout, clearTimer = clearTimeout} = {}) {
  const $ = id => document.getElementById(id), list = $('policy-history');
  if (!list) return null;
  list.dataset.readingHistory = 'true';
  list.setAttribute('aria-label', 'Presence readings with receipt times and policy comparisons');
  const model = createReadingHistory(), readingClock = createTextboxReadingClock({now, monotonicNow}), pulseRenderer = createReadingPulseRenderer($('pulse-view'), {loadAnimator});
  let current = {rows: [], coverage: 'observed', generation: null, omitted: null},
    replayTimer = null, replaying = false, revision = '', closed = false;
  const clock = row => new Date(row.received_at).toLocaleTimeString('en-GB', {hourCycle: 'h23'});
  const number = index => (current.omitted ?? 0) + index + 1;
  const button = on => {const b = $('pulse-replay'); if (!b) return; b.setAttribute('aria-pressed', String(on)); b.title = on ? 'Pause the replay' : 'Play the readings back'; b.setAttribute('aria-label', b.title);};
  const stopReplay = () => {if (replayTimer !== null) clearTimer(replayTimer); replayTimer = null; replaying = false; button(false);};
  function show(row, replay = false) {
    const art = $('pulse-view'); if (!art) return;
    const index = current.rows.findIndex(x => x.reading_id === row?.reading_id);
    const caption = !row ? 'ordinary fallback' : `${replay ? 'Replay · ' : ''}Reading ${number(index)} · ${clock(row)}`;
    $('pulse-view-caption').textContent = caption;
    renderReadingPolicyCard(document, row?.controls, current.rows[index - 1]?.controls, {replay});
    const description = row ? caption + ' · ' + readingPolicySummary(row, current.rows[index - 1]) : 'No current guidance · ordinary fallback';
    art.setAttribute('aria-label', description + '. Illustrative policy-derived shape, not measured RFS; delivery to Muse is shown separately.');
    for (const item of list.children) {const active = !!row && item.dataset.readingId === row.reading_id; item.dataset.active = String(active); if (active) revealReadingRow(list, item);}
    void pulseRenderer.update(row);
  }
  function renderRows() {
    list.replaceChildren();
    current.rows.forEach((row, i) => {
      const item = document.createElement('li'); item.dataset.kind = 'reading'; item.dataset.readingId = row.reading_id;
      const stamp = document.createElement('time'); stamp.textContent = clock(row); stamp.setAttribute('datetime', row.received_at); stamp.title = row.received_at; item.append(stamp);
      for (const [index, key] of FIELDS.entries()) {
        const value = document.createElement('span'); value.className = 'pv-value'; value.textContent = label(row.controls[key]);
        value.dataset.adapted = String(row.controls[key] !== ORDINARY[index]);
        value.dataset.changed = String(Boolean(current.rows[i - 1]) && row.controls[key] !== current.rows[i - 1].controls[key]); item.append(value);
      }
      const note = document.createElement('span'); note.className = 'pv-note'; note.textContent = `Reading ${number(i)} · ${readingPolicySummary(row, current.rows[i - 1])}`; item.append(note); list.append(item);
    });
    if (!current.rows.length) {const item = document.createElement('li'); item.className = 'empty'; item.textContent = current.coverage === 'session' ? 'No Presence reading received yet.' : 'No reading available from this backend snapshot.'; list.append(item);}
    list.scrollTop = list.scrollHeight;
    $('pulse-replay').disabled = current.rows.length === 0;
  }
  let latestEligible = false, latestFreshness = 'unavailable';
  const replay = () => {
    if (replaying) {stopReplay(); void show(latestEligible ? current.rows.at(-1) : null); return;}
    if (current.rows.length === 0) return;
    const rows = current.rows.slice(); let index = 0; replaying = true; button(true);
    const step = () => {if (closed) return; void show(rows[index++], true); replayTimer = setTimer(() => {
      if (index < rows.length) step(); else {stopReplay(); void show(latestEligible ? current.rows.at(-1) : null);}
    }, 1600);}; step();
  };
  $('pulse-replay').addEventListener('click', replay);
  return {render(state, {connected = true} = {}) {
    if (closed) return;
    const next = model.update(state), textbox = state?.textbox, last = next.rows.at(-1), historyChanged = JSON.stringify(current) !== JSON.stringify(next);
    const reading = readingClock(textbox);
    latestEligible = !!last && connected && last.reading_id === textbox?.reading_id && reading.current;
    latestFreshness = latestEligible ? reading.readingFreshness : 'unavailable';
    const key = JSON.stringify([next, latestEligible, latestFreshness]);
    if (key === revision) return;
    revision = key; current = next; if (historyChanged) stopReplay(); renderRows();
    const scope = current.coverage === 'session' ? (current.omitted ? `${current.omitted} earlier readings omitted · ` : '') : 'Observed in this tab; earlier readings unavailable · ';
    $('policy-latest').textContent = scope + `${current.rows.length} reading${current.rows.length === 1 ? '' : 's'}${last ? ' · latest ' + clock(last) : ''}` + (!latestEligible && last ? ' · ordinary fallback' : latestFreshness === 'last_known' ? ' · using last reading' : '');
    const card = $('presence-policy-depth')?.closest('.presence-policy'); if (card) card.dataset.stale = String(!latestEligible && !!last);
    if ($('policy-last')) {
      const summary = last ? readingPolicySummary(last, current.rows.at(-2)) : '';
      const short = !last ? '' : summary === 'First policy' ? 'First' : summary === 'Policy unchanged' ? 'Unchanged' : summary === 'Policy comparison unavailable' ? 'Comparison unavailable' : 'Changed';
      $('policy-last').textContent = last ? `Reading ${number(current.rows.length - 1)} · ${short}` : 'No reading received';
      $('policy-last').title = summary;
    }
    if (!replaying) void show(latestEligible ? last : null);
  }, close() {closed = true; pulseRenderer.close(); stopReplay(); $('pulse-replay').removeEventListener('click', replay);}};
}
