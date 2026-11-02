// Native v0.4 consumer: validates, then inserts A2's returned text verbatim.
// No category-to-prose translation or operating defaults live here.
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from '../../../contract/schema/open-presence-controls-v0.4.schema.json';
import type {CodingDecisions} from './coding-decisions.js';

export interface CodingInstructions extends Omit<CodingDecisions, 'schema'> {
  schema: 'open_presence.controls.v0.4';
  instructions: {version: 'coding-instructions.1' | 'coding-instructions.2' | 'coding-instructions.3';
    llm: {preamble: string; extent_preamble: string};
    application: {unsolicited_update: string}};
}
const ajv = new Ajv2020(); addFormats(ajv);
const validate = ajv.compile<CodingInstructions>(schema);
export function resolveCodingInstructions(value: unknown, now = Date.now()):
  {status: 'usable'; capsule: CodingInstructions} |
  {status: 'unavailable' | 'invalid' | 'future' | 'non_live'} {
  if (value == null) return {status: 'unavailable'};
  if (!validate(value)) return {status: 'invalid'};
  if (Date.parse(value.generated_at) - now > 2000) return {status: 'future'};
  if (value.provenance.provider_kind !== 'production' || value.provenance.conformance_only) return {status: 'non_live'};
  return {status: 'usable', capsule: value};
}
export function instructionAgentOptions(baseSystem: string, value: unknown, now = Date.now()) {
  const result = resolveCodingInstructions(value, now);
  if (result.status !== 'usable') return {system: baseSystem, applied: [] as string[]};
  return {system: baseSystem + '\n' + result.capsule.instructions.llm.preamble,
    applied: ['response_extent', 'conversation_style']};
}
export function instructionExtentOptions(baseSystem: string, value: unknown, now = Date.now()) {
  const result = resolveCodingInstructions(value, now);
  if (result.status !== 'usable') return {system: baseSystem, presence: result.status, adapted: false};
  return {system: baseSystem + '\n' + result.capsule.instructions.llm.extent_preamble,
    presence: 'usable', adapted: true};
}

export type InstructionPlacement = 'system' | 'preamble';

/** Transport only: never rewrite supplied guidance or the user's request. */
export function placeModelInstructions(system: string, prompt: string,
  placement: InstructionPlacement = 'system') {
  if (placement === 'system') return {system, prompt};
  if (placement !== 'preamble') throw Error('Unsupported instruction placement');
  return {system: '', prompt: system
    ? `Application instructions:\n${system}\n\nUser request:\n${prompt}` : prompt};
}

/** Framework-independent attachment for a trusted, validated live Capsule. */
export function attachCodingInstructions(baseSystem: string, prompt: string, value: unknown,
  options: {placement?: InstructionPlacement; now?: number; extentOnly?: boolean} = {}) {
  const resolution = resolveCodingInstructions(value, options.now);
  const guidance = resolution.status === 'usable'
    ? resolution.capsule.instructions.llm[options.extentOnly ? 'extent_preamble' : 'preamble'] : '';
  return {...placeModelInstructions(guidance ? `${baseSystem}\n${guidance}` : baseSystem,
    prompt, options.placement), presence: resolution.status,
    applied: guidance ? (options.extentOnly ? ['response_extent'] : ['response_extent', 'conversation_style']) : []};
}
