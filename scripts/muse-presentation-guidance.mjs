// Optional, policy-derived presentation hints. This does not rewrite answers,
// authorize actions, prescribe a fixed template or infer personal state.
export const MUSE_PRESENTATION_VERSION = 2;
export const MUSE_PRESENTATION_MAX_BYTES = 384;
const EXTENT = Object.freeze({
  terse: 'Spotlight the decision; a tiny callout or text flow may replace extra prose.',
  standard: "Balance context; a compact comparison or callout may clarify a real choice.",
  full: 'Connect steps and trade-offs; a small text diagram or table may clarify them.',
});
const UPDATE = Object.freeze({
  send: 'Share useful milestones.',
  defer: 'Defer optional progress, never required interaction.',
});
const STYLE = Object.freeze({
  conversational: 'Invite input on real choices; make trade-offs easy to compare.',
  self_contained: 'Keep actions and dependencies clear; clarify when needed.',
});
const QUALITY = "Presentation only: fit content, no fixed layout. Replace prose; don't duplicate it or invent claims/questions. User format and required substance/checks win.";
const KEYS = ['response_extent', 'unsolicited_update', 'conversation_style'];
export function compileMusePresentation(controls) {
  try {
    if (!controls || typeof controls !== 'object') return null;
    const proto = Object.getPrototypeOf(controls);
    if (proto !== Object.prototype && proto !== null || Reflect.ownKeys(controls).length !== KEYS.length) return null;
    const descriptors = Object.getOwnPropertyDescriptors(controls), values = [];
    for (const [index, key] of KEYS.entries()) {
      const descriptor = descriptors[key], choices = [EXTENT, UPDATE, STYLE][index];
      if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string' || !Object.hasOwn(choices, descriptor.value)) return null;
      values.push(choices[descriptor.value]);
    }
    const text = `Muse collaboration v2:\n${values.join('\n')}\n${QUALITY}`;
    const utf8_bytes = new TextEncoder().encode(text).length;
    if (utf8_bytes + 1 > MUSE_PRESENTATION_MAX_BYTES) return null;
    return {version: MUSE_PRESENTATION_VERSION, text, utf8_bytes};
  } catch { return null; }
}
