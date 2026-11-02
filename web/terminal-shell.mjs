// Presentation shell for the comparison page. It only reads what
// terminal-app.mjs renders and never sends terminal input, messages or
// approvals. Focus shortcuts reuse the existing "Type here" buttons, so the
// same readiness checks apply.
import {revealReadingRow,renderReadingPolicyCard} from './terminal-presence-view.mjs';
const $ = id => document.getElementById(id);
const arms = ['without', 'with'];

// Status chip tone, derived from the state text the page renders. Handles
// both terminal labels and session labels (with an optional " · activity"
// suffix). The two exact checks below are kept verbatim for adapters.
function tone(raw) {
  if (/^Disconnected\b/.test(raw)) return 'warn';
  const text = raw.split(' · ')[0].trim();
  if (text === 'Approval needed') return 'attention';
  if (['Ready', 'Interactive'].includes(text)) return 'live';
  if (['Starting', 'Working', 'Stopping'].includes(text)) return 'busy';
  if (text === 'Interactive') return 'live';
  if (['Preparing', 'Restoring'].includes(text)) return 'busy';
  if (['Not started', 'Closed'].includes(text)) return 'idle';
  return 'warn';
}
function paintStates() {
  for (const arm of arms) { const el = $('state-' + arm); if (!el) continue; const text = el.textContent.trim(); el.dataset.tone = tone(text); el.title = text; }
}

// Session timer: time since this page saw both terminals interactive.
let startedAt = null, timerId = null;
function tickTimer() {
  const el = $('session-timer'); if (!el || startedAt === null) return;
  const s = Math.floor((Date.now() - startedAt) / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = s % 60;
  el.textContent = (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(r).padStart(2, '0');
}
function updateTimer() {
  const live = arms.every(arm => $('state-' + arm)?.textContent.trim() === 'Interactive');
  const closed = arms.every(arm => ['Closed', 'Not started'].includes($('state-' + arm)?.textContent.trim()));
  if (live && startedAt === null) { startedAt = Date.now(); resetRatings(); markNewSession(); $('session-timer').hidden = false; tickTimer(); timerId = setInterval(tickTimer, 1000); }
  if (closed && startedAt !== null) { clearInterval(timerId); timerId = null; startedAt = null; $('session-timer').hidden = true; }
}

// Keyboard: Option+1 / Option+2 focus a terminal, Option+M the message box.
window.addEventListener('keydown', event => {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const target = {Digit1: 'focus-without', Digit2: 'focus-with'}[event.code];
  if (target) { event.preventDefault(); event.stopPropagation(); const button = $(target); if (button && !button.disabled) button.click(); else flash(button?.closest('.terminal-pane')); return; }
  if (event.code === 'KeyM') { event.preventDefault(); event.stopPropagation(); $('shared')?.focus(); }
}, true);
function flash(pane) { if (!pane) return; pane.dataset.flash = 'blocked'; setTimeout(() => { delete pane.dataset.flash; }, 600); }

// Policy history for this tab only. A marker separates session pairs.
let sessionsOpened = 0;
function markNewSession() {
  if ($('policy-history')?.dataset.readingHistory === 'true') return;
  sessionsOpened += 1;
  if (sessionsOpened < 2 || !history.length) return;
  push({kind: 'session'});
}
const FIELDS = [['depth', 'Depth'], ['updates', 'Updates'], ['conversation', 'Conversation']];
const SCALES = {depth: ['Terse', 'Standard', 'Full'], updates: ['Defer', 'Send'], conversation: ['Self contained', 'Conversational']};
const ORDINARY = {depth: 'Standard', updates: 'Send', conversation: 'Conversational'};
let lastPolicy = null, lastKnown = null; const history = [];
function readPolicy() {
  const values = Object.fromEntries(FIELDS.map(([key]) => [key, $('presence-policy-' + key)?.textContent.trim() || '—']));
  return Object.values(values).every(v => v === '—') ? null : values;
}
function clock() { return new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'}); }
function push(entry) { history.unshift({time: clock(), ...entry}); history.length = Math.min(history.length, 12); renderHistory(); }
function recordPolicy() {
  if ($('policy-history')?.dataset.readingHistory === 'true') return;
  const current = readPolicy(), key = JSON.stringify(current);
  if (key === JSON.stringify(lastPolicy)) return;
  if (!current) { if (lastPolicy) push({kind: 'none'}); }
  else {
    const changed = lastPolicy ? FIELDS.filter(([k]) => current[k] !== lastPolicy[k]).map(([k]) => k) : FIELDS.map(([k]) => k);
    if (lastPolicy) for (const k of changed) { const row = document.querySelector(`.policy-row[data-policy="${k}"]`); if (row) { row.dataset.changed = 'true'; setTimeout(() => { delete row.dataset.changed; }, 2400); } }
    lastKnown = {time: clock(), values: current};
    push({kind: 'policy', values: current, changed, first: !lastPolicy});
  }
  lastPolicy = current;
  paintCardState();
}
// Pulse over this session: ONE Pulse that morphs as the policy changes, with
// Replay to play the session back; below it, every change with its time, the
// changed levers flagged and the replayed row highlighted.
const PULSE_VALUE = {depth: {Terse: .25, Standard: .5, Full: .75}, updates: {Send: .25, Defer: .75}, conversation: {'Self contained': .25, Conversational: .75}};
const printer = import('/lab/pulse.mjs').then(m => m.PresencePrintAnimator).catch(() => null);
const track = []; let animator = null, replaying = null;
function pulseValues(values) { const v = FIELDS.map(([k]) => PULSE_VALUE[k][values[k]]); return v.every(Number.isFinite) ? v : null; }
function summary(entry, previous) {
  if (entry.kind === 'session') return 'New sessions opened';
  if (entry.kind === 'none') return 'No current policy, ordinary behavior';
  if (entry.first || !previous) return FIELDS.map(([k]) => entry.values[k]).join(' · ');
  return FIELDS.filter(([k]) => entry.changed.includes(k)).map(([k, label]) => `${label} ${previous[k]} → ${entry.values[k]}`).join(' · ');
}
async function showOnPulse(entry, replay = false) {
  const art = $('pulse-view'); if (!art) return;
  const asControls = values => values ? {response_extent: values.depth.toLowerCase(), unsolicited_update: values.updates.toLowerCase(), conversation_style: values.conversation.toLowerCase().replaceAll(' ', '_')} : null;
  const index = track.indexOf(entry), prior = track.slice(0, index).findLast(row => row.kind === 'policy' || row.kind === 'session');
  const controls = entry?.kind === 'policy' ? asControls(entry.values) : null;
  art.dataset.available = String(!!controls);
  renderReadingPolicyCard(document, controls, prior?.kind === 'policy' ? asControls(prior.values) : null, {replay});
  const cap = $('pulse-view-caption');
  if (cap) cap.textContent = controls ? `${replay ? 'Replay · ' : ''}${entry.time}` : 'ordinary fallback';
  for (const row of document.querySelectorAll('#policy-history li')) {const active = row.dataset.index === String(index); row.dataset.active = String(active); if (active) revealReadingRow($('policy-history'), row);}
  const Animator = await printer; if (!Animator) return;
  if (!animator) animator = new Animator(art);
  const values = controls ? pulseValues(entry.values) : null;
  if (values) {animator.update(values); animator.setActive(true);} else {animator.clear(); animator.setActive(false);}
}

function renderList() {
  const list = $('policy-history'); if (!list) return;
  if (!track.length) return;
  let previous = null;
  list.replaceChildren(...track.map((entry, i) => {
    const li = document.createElement('li'); li.dataset.kind = entry.kind; li.dataset.index = String(i);
    const t = document.createElement('time'); t.textContent = entry.time; li.append(t);
    if (entry.kind === 'policy') {
      for (const [k] of FIELDS) { const v = document.createElement('span'); v.className = 'pv-value'; v.textContent = entry.values[k]; v.dataset.adapted = String(entry.values[k] !== ORDINARY[k]); v.dataset.changed = String(Boolean(previous) && previous[k] !== entry.values[k]); li.append(v); }
      previous = entry.values;
    } else { const n = document.createElement('span'); n.className = 'pv-note'; n.textContent = entry.kind === 'session' ? 'New sessions opened' : 'No current policy · ordinary behavior'; li.append(n); if (entry.kind === 'session') previous = null; }
    return li;
  }));
  list.scrollTop = list.scrollHeight;
  const replay = $('pulse-replay'); if (replay) replay.disabled = track.filter(e => e.kind !== 'session').length < 2;
}
function setReplayButton(on) { const b = $('pulse-replay'); if (!b) return; b.setAttribute('aria-pressed', String(on)); const label = on ? 'Pause the replay' : 'Play the session back'; b.setAttribute('aria-label', label); b.title = label; }
function stopReplay() { if (replaying) { clearTimeout(replaying); replaying = null; } setReplayButton(false); }
$('pulse-replay')?.addEventListener('click', () => {
  if ($('policy-history')?.dataset.readingHistory === 'true') return;
  if (replaying) { stopReplay(); void showOnPulse(track.at(-1)); return; }
  const steps = track.filter(e => e.kind !== 'session'); let i = 0;
  setReplayButton(true);
  const step = () => { void showOnPulse(steps[i], true); i += 1; replaying = i < steps.length ? setTimeout(step, 1600) : setTimeout(() => { stopReplay(); void showOnPulse(track.at(-1)); }, 1600); };
  step();
});
function renderHistory() {
  const latest = history.at(0);
  if (latest) {
    const prev = history.slice(1).find(e => e.kind === 'policy')?.values, text = `${latest.time} · ${summary(latest, prev)}`;
    const line = $('policy-latest'); if (line) line.textContent = text;
    $('pulse-view')?.setAttribute('aria-label', 'Pulse drawn from the current policy. Latest change: ' + text);
    if (latest !== track.at(-1)) { track.push(latest); track.splice(0, Math.max(0, track.length - 200)); renderList(); if (!replaying && latest.kind !== 'session') void showOnPulse(latest); }
  }
  const changes = history.filter(e => e.kind === 'policy').length;
  if (changes && readPolicy()) { const last = $('policy-last'); if (last) last.textContent = changes > 1 ? `Changed ${changes - 1}× · last ${history.find(e => e.kind === 'policy').time}` : `First seen ${history.find(e => e.kind === 'policy').time}`; }
}
// Without a current policy, the card says which policy was last seen and when,
// instead of a column of dashes.
function paintCardState() {
  const card = $('presence-policy-depth')?.closest('.presence-policy'); if (!card) return;
  const stale = !readPolicy() && lastKnown !== null; card.dataset.stale = String(stale);
  const last = $('policy-last');
  if (last && stale) last.textContent = `Last: ${FIELDS.map(([k]) => lastKnown.values[k]).join(' · ')} at ${lastKnown.time}`;
}

// Experience rating: in memory only, never sent or stored. Ratings belong to
// one session pair, so they clear whenever sessions are opened again.
function resetRatings() {
  for (const group of document.querySelectorAll('.rate')) { group.dataset.score = ''; for (const b of group.querySelectorAll('button[data-score]')) b.setAttribute('aria-pressed', 'false'); }
}
$('start')?.addEventListener('click', resetRatings);
for (const group of document.querySelectorAll('.rate')) {
  group.addEventListener('click', event => {
    const button = event.target.closest('button[data-score]'); if (!button) return;
    const already = button.getAttribute('aria-pressed') === 'true';
    for (const b of group.querySelectorAll('button[data-score]')) b.setAttribute('aria-pressed', String(!already && b === button));
    group.dataset.score = already ? '' : button.dataset.score;
  });
}

// Presenter mode: full screen with secondary panels hidden.
$('present')?.addEventListener('click', async () => {
  const on = document.body.dataset.present !== 'true';
  document.body.dataset.present = String(on); $('present').setAttribute('aria-pressed', String(on));
  try { if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen?.(); else if (!on && document.fullscreenElement) await document.exitFullscreen?.(); } catch {}
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.body.dataset.present === 'true') { document.body.dataset.present = 'false'; $('present')?.setAttribute('aria-pressed', 'false'); }
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
});

// Observe the elements terminal-app.mjs updates.
const observer = new MutationObserver(() => { paintStates(); updateTimer(); recordPolicy(); });
for (const id of ['state-without', 'state-with', 'presence-policy-depth', 'presence-policy-updates', 'presence-policy-conversation']) {
  const el = $(id); if (el) observer.observe(el, {childList: true, characterData: true, subtree: true});
}
paintStates(); updateTimer(); recordPolicy();

// Match the empty comparison card to the rendered source card, including
// wrapping policy values and responsive/font changes. Width is shared in CSS.
const sourcePolicyCard = document.querySelector('.presence-pane .presence-policy');
const emptyPolicyCard = document.querySelector('.baseline-inline .policy-none');
if (sourcePolicyCard && emptyPolicyCard) {
  const matchPolicyHeight = () => {
    const height = sourcePolicyCard.getBoundingClientRect().height;
    if (height > 0) emptyPolicyCard.style.setProperty('--paired-policy-height', height + 'px');
  };
  new ResizeObserver(matchPolicyHeight).observe(sourcePolicyCard, {box: 'border-box'});
  matchPolicyHeight();
}
