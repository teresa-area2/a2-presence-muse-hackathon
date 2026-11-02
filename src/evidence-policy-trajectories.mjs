// Scripted engineering policies only. No typing, inference, OP or model call.
import {randomUUID} from 'node:crypto';
import matrix from '../tests/fixtures/coding-instructions-3-matrix.json' with {type: 'json'};
import {EVIDENCE_TRAJECTORY_IDS} from './evidence-batch-plan.mjs';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const keys = ['response_extent', 'unsolicited_update', 'conversation_style'];
const controls = (response_extent, unsolicited_update, conversation_style) => Object.freeze({response_extent, unsolicited_update, conversation_style});
const FULL = controls('full', 'send', 'conversational');
const TERSE = controls('terse', 'defer', 'self_contained');
const STANDARD = controls('standard', 'send', 'conversational');
const FRAMES = Object.freeze({steady: [STANDARD], 'change-during-work': [FULL, TERSE], 'fallback-return': [FULL, TERSE, null, FULL]});
const fail = reason => {throw Error(reason);};
const clone = value => structuredClone(value);
function freeze(value) { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
function guidanceFor(value) {
  const found = matrix.filter(row => keys.every(key => row.controls?.[key] === value[key]));
  const row = found[0], text = row?.instructions?.llm?.preamble;
  if (found.length !== 1 || row.instructions.version !== 'coding-instructions.3' || row.provenance?.conformance_only !== true || row.provenance?.provider_kind !== 'fixture' || typeof text !== 'string' || !text.trim() || text.length > 12000) fail('evidence_policy_fixture_invalid');
  return text; // Verbatim committed fixture bytes; contextual hints belong to the bridge.
}
const GUIDANCE = new Map([FULL, TERSE, STANDARD].map(value => [JSON.stringify(value), guidanceFor(value)]));
function frameAt(id, read) {
  if (id === 'steady') return 0;
  if (id === 'change-during-work') return read <= 2 ? 0 : 1;
  return read <= 1 ? 0 : read === 2 ? 1 : read <= 4 ? 2 : 3;
}

export function createEvidencePolicySource({trajectoryId, scopeId, guidanceVariant = 'op-fixture', now = Date.now, makeId = randomUUID} = {}) {
  if (!EVIDENCE_TRAJECTORY_IDS.includes(trajectoryId) || typeof scopeId !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(scopeId) || !['op-fixture', 'contextual-v2'].includes(guidanceVariant) || typeof now !== 'function' || typeof makeId !== 'function') fail('evidence_policy_source_invalid');
  let read_sequence = 0, frame_index = 0, frame_id, selected_at_ms, selections_omitted = 0;
  const ids = new Set(), selections = [];
  const clock = () => { const at = now(); if (!Number.isSafeInteger(at) || at < 0 || at > 8640000000000000) fail('evidence_policy_clock_invalid'); return at; };
  const freshId = () => { const id = makeId(); if (typeof id !== 'string' || !UUID.test(id) || ids.has(id)) fail('evidence_policy_id_invalid'); ids.add(id); return id; };
  selected_at_ms = clock(); frame_id = freshId();
  const selection = () => {
    const value = FRAMES[trajectoryId][frame_index];
    return freeze(value ? {status: 'selected', guidance: GUIDANCE.get(JSON.stringify(value)), controls: {...value}, reading_id: frame_id, age_ms: 0, renderer: 'coding-instructions.3'} :
      {status: 'fallback', guidance: null, controls: null, reading_id: null, age_ms: null, renderer: null});
  };
  const snapshot = () => {
    const current = selection();
    return freeze({synthetic: true, scope_id: scopeId, trajectory_id: trajectoryId, guidance_variant: guidanceVariant,
      policy_source: 'synthetic_conformance_fixture', calibration: 'not_assessed', human_state: 'not_measured', human_benefit: 'not_measured', model_compliance: 'not_established',
      experimental: guidanceVariant === 'contextual-v2', quality_status: guidanceVariant === 'contextual-v2' ? 'quality_failed_not_promoted' : 'fixture_conformance_only',
      read_sequence, frame_index, frame_id, selected_at_ms, selected: current.status === 'selected', controls: current.controls, reading_id: current.reading_id,
      selections: clone(selections), selections_omitted});
  };
  return Object.freeze({
    selectForRequest() {
      if (read_sequence >= 1024) fail('evidence_policy_read_limit');
      const next = read_sequence + 1, index = frameAt(trajectoryId, next), at = clock();
      const id = index !== frame_index ? freshId() : frame_id;
      read_sequence = next; frame_index = index; frame_id = id; selected_at_ms = at;
      return selection();
    },
    snapshot,
    recordSelection(stage, supplied) {
      if (!['hook', 'send'].includes(stage)) fail('evidence_policy_stage_invalid');
      const current = selection();
      if (supplied !== undefined && JSON.stringify(supplied) !== JSON.stringify(current)) fail('evidence_policy_selection_mismatch');
      const row = {stage, at_ms: clock(), read_sequence, frame_index, selected: current.status === 'selected', reading_id: current.reading_id};
      if (selections.length === 64) {selections.shift(); selections_omitted++;}
      selections.push(row);
      return current;
    },
  });
}
