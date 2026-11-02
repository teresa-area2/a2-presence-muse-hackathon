// Opt-in v3 presentation guidance. V2 remains an immutable separate renderer.
// A visual replaces prose only when the task benefits; explicit formats win.
export const MUSE_PRESENTATION_VERSION = 3;
export const MUSE_PRESENTATION_MAX_BYTES = 384;
const EXTENT = Object.freeze({
  terse: 'Spotlight the decision; a tiny callout or text flow may replace extra prose.',
  standard: 'Balance context; a compact comparison or callout may clarify a real choice.',
  full: 'For flows or comparisons, prefer a small text diagram/table over prose when clearer; otherwise prose.',
});
const UPDATE = Object.freeze({
  send: 'Share useful milestones.',
  defer: 'Defer optional progress, never required interaction.',
});
const STYLE = Object.freeze({
  conversational: 'Invite input on real choices; make trade-offs easy to compare.',
  self_contained: 'Keep actions and dependencies clear; clarify when needed.',
});
const QUALITY = "Presentation only; no fixed layout. Replace prose, don't duplicate or invent claims/questions. User format and required content/checks win.";
const KEYS = ['response_extent', 'unsolicited_update', 'conversation_style'];
export function compileMusePresentation(controls) {
  try {
    if (!controls || typeof controls !== 'object') return null;
    const prototype = Object.getPrototypeOf(controls);
    if (prototype !== Object.prototype && prototype !== null || Reflect.ownKeys(controls).length !== KEYS.length) return null;
    const descriptors = Object.getOwnPropertyDescriptors(controls), values = [];
    for (const [index, key] of KEYS.entries()) {
      const descriptor = descriptors[key], choices = [EXTENT, UPDATE, STYLE][index];
      if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string' || !Object.hasOwn(choices, descriptor.value)) return null;
      values.push(choices[descriptor.value]);
    }
    const text = `Muse collaboration v3:\n${values.join('\n')}\n${QUALITY}`;
    const utf8_bytes = new TextEncoder().encode(text).length;
    if (utf8_bytes + 1 > MUSE_PRESENTATION_MAX_BYTES) return null;
    return {version: MUSE_PRESENTATION_VERSION, text, utf8_bytes};
  } catch { return null; }
}
