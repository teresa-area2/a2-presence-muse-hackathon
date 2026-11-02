export const PRESENTATION_EVENT_LIMIT = 100;

const MAX_ITEMS = 576;
const MAX_AT_MS = 8640000000000000;
const MESSAGE = 'presentation_ledger_invalid';

function invalid() {
  throw new Error(MESSAGE);
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkClosedKeys(value, allowed, required) {
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!allowed.includes(key)) invalid();
  }
  for (const key of required) {
    if (!keys.includes(key)) invalid();
  }
  return keys;
}

function isSafeNonNegative(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function cloneControls(controls) {
  return controls === null ? null : {
    response_extent: controls.response_extent,
    unsolicited_update: controls.unsolicited_update,
    conversation_style: controls.conversation_style,
  };
}

export function createPresentationLedger(options) {
  if (!isObject(options)) invalid();
  checkClosedKeys(options, ['arm'], ['arm']);
  const arm = options.arm;
  if (arm !== 'without' && arm !== 'with') invalid();

  let hasObserved = false;
  let currentGeneration = null;
  let currentEpoch = null;
  let lastAtMs = null;
  let revision = 0;
  let lastSequence = 0;
  let eventsOmitted = 0;
  let coverage = 'observed';
  let events = [];
  let itemState = new Map();

  function snapshot() {
    if (!hasObserved) return null;
    return {
      schema_version: 1,
      source: 'browser_current_display_policy',
      arm,
      session_generation: currentGeneration,
      history_epoch: currentEpoch,
      revision,
      events_omitted: eventsOmitted,
      coverage,
      events: events.map((event) => ({
        sequence: event.sequence,
        revision: event.revision,
        history_epoch: event.history_epoch,
        kind: event.kind,
        ordinal: event.ordinal,
        event: event.event,
        reason: event.reason,
        at_ms: event.at_ms,
        controls: cloneControls(event.controls),
      })),
    };
  }

  function reset() {
    hasObserved = false;
    currentGeneration = null;
    currentEpoch = null;
    lastAtMs = null;
    revision = 0;
    lastSequence = 0;
    eventsOmitted = 0;
    coverage = 'observed';
    events = [];
    itemState = new Map();
  }

  function observe(input) {
    if (!isObject(input)) invalid();
    const inputKeys = checkClosedKeys(
      input,
      ['session_generation', 'history_epoch', 'items', 'policy', 'at_ms', 'manual'],
      ['session_generation', 'history_epoch', 'items', 'at_ms'],
    );

    const sessionGeneration = input.session_generation;
    const historyEpoch = input.history_epoch;
    const atMs = input.at_ms;
    const rawItems = input.items;
    let manual = false;
    if (inputKeys.includes('manual')) {
      manual = input.manual;
      if (typeof manual !== 'boolean') invalid();
    }

    if (!(typeof sessionGeneration === 'number' && Number.isSafeInteger(sessionGeneration) && sessionGeneration > 0)) invalid();
    if (!isSafeNonNegative(historyEpoch)) invalid();
    if (!(isSafeNonNegative(atMs) && atMs <= MAX_AT_MS)) invalid();

    let policyMode = 'baseline';
    let currentControls = null;
    if (arm === 'with') {
      if (!inputKeys.includes('policy')) invalid();
      const policy = input.policy;
      if (!isObject(policy)) invalid();
      checkClosedKeys(policy, ['mode', 'controls'], ['mode', 'controls']);
      policyMode = policy.mode;
      if (policyMode !== 'eligible' && policyMode !== 'fallback' && policyMode !== 'disconnected') invalid();
      if (policyMode === 'eligible') {
        const controls = policy.controls;
        if (!isObject(controls)) invalid();
        checkClosedKeys(
          controls,
          ['response_extent', 'unsolicited_update', 'conversation_style'],
          ['response_extent', 'unsolicited_update', 'conversation_style'],
        );
        if (!['terse', 'standard', 'full'].includes(controls.response_extent)) invalid();
        if (!['send', 'defer'].includes(controls.unsolicited_update)) invalid();
        if (!['conversational', 'self_contained'].includes(controls.conversation_style)) invalid();
        currentControls = cloneControls(controls);
      } else if (policy.controls !== null) {
        invalid();
      }
    }

    if (!Array.isArray(rawItems) || rawItems.length > MAX_ITEMS) invalid();
    const items = [];
    const seen = new Set();
    for (const rawItem of rawItems) {
      if (!isObject(rawItem)) invalid();
      checkClosedKeys(rawItem, ['kind', 'ordinal', 'optional', 'visible'], ['kind', 'ordinal', 'optional', 'visible']);
      const kind = rawItem.kind;
      const ordinal = rawItem.ordinal;
      const optional = rawItem.optional;
      const visible = rawItem.visible;
      if (kind !== 'message' && kind !== 'approval' && kind !== 'question') invalid();
      if (!(typeof ordinal === 'number' && Number.isSafeInteger(ordinal) && ordinal >= 1 && ordinal <= 4096)) invalid();
      if (typeof optional !== 'boolean' || typeof visible !== 'boolean') invalid();
      if ((kind === 'approval' || kind === 'question') && (optional !== false || visible !== true)) invalid();
      if (kind === 'message' && optional === false && visible !== true) invalid();
      if (arm === 'without' && visible !== true) invalid();
      const identity = kind + ':' + ordinal;
      if (seen.has(identity)) invalid();
      seen.add(identity);
      items.push({ kind, ordinal, optional, visible });
    }

    const isFirst = !hasObserved;
    const generationChange = hasObserved && sessionGeneration !== currentGeneration;
    if (hasObserved && sessionGeneration < currentGeneration) invalid();
    let epochChange = false;
    if (hasObserved && !generationChange) {
      if (historyEpoch < currentEpoch) invalid();
      if (atMs < lastAtMs) invalid();
      epochChange = historyEpoch > currentEpoch;
    }

    const effectiveState = isFirst || generationChange || epochChange ? new Map() : itemState;

    if (hasObserved && !generationChange && !epochChange) {
      const present = new Set(items.map((item) => item.kind + ':' + item.ordinal));
      for (const prior of itemState.values()) {
        if (prior.kind === 'message' && !present.has(prior.kind + ':' + prior.ordinal)) invalid();
      }
    }

    const planned = [];
    for (const item of items) {
      const identity = item.kind + ':' + item.ordinal;
      const prior = effectiveState.get(identity);
      if (prior !== undefined) {
        if (prior.optional !== item.optional) invalid();
        if (prior.visible === true && item.visible === false) invalid();
        if (prior.visible === item.visible) continue;
        let reason;
        if (arm === 'without') reason = 'baseline';
        else if (manual) reason = 'manual';
        else if (policyMode === 'eligible') reason = currentControls.unsolicited_update === 'send' ? 'send' : 'not_held';
        else reason = policyMode;
        planned.push({ kind: item.kind, ordinal: item.ordinal, event: 'released', reason });
      } else if (item.visible === false) {
        if (policyMode !== 'eligible' || currentControls.unsolicited_update !== 'defer') invalid();
        planned.push({ kind: item.kind, ordinal: item.ordinal, event: 'held', reason: 'defer' });
      } else {
        let reason;
        if (item.optional === false) reason = 'mandatory';
        else if (arm === 'without') reason = 'baseline';
        else if (policyMode === 'eligible') reason = currentControls.unsolicited_update === 'send' ? 'send' : 'not_held';
        else reason = policyMode;
        planned.push({ kind: item.kind, ordinal: item.ordinal, event: 'shown', reason });
      }
    }

    const baseRevision = isFirst || generationChange ? 0 : revision;
    const baseSequence = isFirst || generationChange ? 0 : lastSequence;
    const retained = isFirst || generationChange ? [] : events.slice();
    let nextEventsOmitted = isFirst || generationChange ? 0 : eventsOmitted;
    let nextCoverage = isFirst || generationChange ? 'observed' : coverage;
    if (epochChange || historyEpoch > 0) nextCoverage = 'partial';
    const nextRevision = baseRevision + (planned.length > 0 || epochChange ? 1 : 0);
    let nextSequence = baseSequence;
    for (const entry of planned) {
      nextSequence += 1;
      retained.push({
        sequence: nextSequence,
        revision: nextRevision,
        history_epoch: historyEpoch,
        kind: entry.kind,
        ordinal: entry.ordinal,
        event: entry.event,
        reason: entry.reason,
        at_ms: atMs,
        controls: arm === 'with' && policyMode === 'eligible' ? cloneControls(currentControls) : null,
      });
    }
    if (retained.length > PRESENTATION_EVENT_LIMIT) {
      const removed = retained.length - PRESENTATION_EVENT_LIMIT;
      retained.splice(0, removed);
      nextEventsOmitted += removed;
      nextCoverage = 'partial';
    }

    const nextState = new Map();
    for (const item of items) {
      nextState.set(item.kind + ':' + item.ordinal, {
        kind: item.kind,
        ordinal: item.ordinal,
        optional: item.optional,
        visible: item.visible,
      });
    }

    hasObserved = true;
    currentGeneration = sessionGeneration;
    currentEpoch = historyEpoch;
    lastAtMs = atMs;
    revision = nextRevision;
    lastSequence = nextSequence;
    events = retained;
    eventsOmitted = nextEventsOmitted;
    coverage = nextCoverage;
    itemState = nextState;
    return snapshot();
  }

  return { observe, snapshot, reset };
}
