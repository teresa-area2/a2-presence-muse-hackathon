export const MUSE_COLLABORATION_VERSION = 1;
export const MUSE_COLLABORATION_MAX_BYTES = 384;

const EXTENT = Object.freeze({
  terse: 'Lead with the result in compact Result/Checks/Risks bullets; omit optional walkthroughs; retain required substance.',
  standard: 'Give result, key rationale, and actual checks; keep detail proportionate.',
  full: 'Explain chosen approach+why, a relevant alternative/trade-off, validation evidence and risks; avoid padding; never invent tests.',
});
const UPDATE = Object.freeze({
  defer: 'Skip optional progress narration; show required decisions/errors/approvals immediately.',
  send: 'Send brief updates only at meaningful milestones.',
});
const STYLE = Object.freeze({
  conversational: 'If a genuine choice is open, ask ONE optional question NOW with your recommended default; continue authorized work. No new approval gates.',
  self_contained: 'Give a complete recommendation plus rationale; avoid optional preference questions or new approval gates. Ask necessary clarification.',
});
const KEYS = ['response_extent', 'unsolicited_update', 'conversation_style'];

export function compileMuseCollaboration(controls) {
  if (typeof controls !== 'object' || controls === null) return null;
  const proto = Object.getPrototypeOf(controls);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Reflect.ownKeys(controls).length !== KEYS.length) return null;
  const descriptors = Object.getOwnPropertyDescriptors(controls);
  const values = {};
  for (const key of KEYS) {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor)) return null;
    values[key] = descriptor.value;
  }
  const extent = values.response_extent;
  const update = values.unsolicited_update;
  const style = values.conversation_style;
  if (typeof extent !== 'string' || !Object.hasOwn(EXTENT, extent)) return null;
  if (typeof update !== 'string' || !Object.hasOwn(UPDATE, update)) return null;
  if (typeof style !== 'string' || !Object.hasOwn(STYLE, style)) return null;
  const text = `Muse collaboration v1:\n${EXTENT[extent]}\n${UPDATE[update]}\n${STYLE[style]}`;
  const utf8_bytes = new TextEncoder().encode(text).length;
  if (utf8_bytes > MUSE_COLLABORATION_MAX_BYTES) return null;
  return { version: MUSE_COLLABORATION_VERSION, text, utf8_bytes };
}
