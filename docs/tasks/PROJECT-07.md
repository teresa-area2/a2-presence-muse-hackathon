# PROJECT-07 — Safe saves without losing the latest edit

Build the task-board conflict-resolution helper in `resolve-conflict.mjs`.
Two quick edits and a concurrent server change must never erase a person's latest
unsaved work. This is real local code with deterministic tests, no server or
third-party dependencies. Both Muse agents receive this same task and source.

First inspect `resolve-conflict.mjs` and `tests/contract.test.mjs`, propose a short plan,
and wait for the person before editing. Ask only for decisions the task truly leaves
open. After the person approves implementation, fix the helper and add focused tests.
Do not edit the supplied contract test. Run `node --test tests/contract.test.mjs` and
any tests you add, and report actual results plus limitations.

## Frozen public contract

`export async function resolveConflict({base, readRemote, readLatestDraft})`

- Base and remote are plain or null-prototype records exactly shaped as
  `{revision: nonempty opaque string, fields:{title:string, done:boolean}}`.
  The latest draft is exactly `{title:string, done:boolean}`. Reject invalid
  callbacks and malformed/unknown/missing fields at their boundaries. Revision
  tokens are opaque: do not assume numbers, ordering or a particular format.
- Await `readRemote()` before calling the synchronous `readLatestDraft()` so
  edits made during the fetch survive. Remote rejection propagates; no draft
  read or retry follows it.
- Compare base, remote and latest draft field by field. A semantic overlap is
  where both local and remote changed relative to base and their final values
  differ. Check semantic overlap BEFORE deciding to retry; a fresh revision by
  itself does not make overwriting a concurrent field safe. Equal concurrent
  edits are compatible.
- Overlap returns exactly `{kind:'conflict', fields:[...], draft:{...}}`, with
  conflicting names ordered title, done. Preserve the whole latest draft for
  explicit human resolution. Never automatically write over an overlap.
- Otherwise include only local changes that still differ from remote in a
  patch. Return exactly `{kind:'retry', expectedRevision:remote.revision,
  patch:{...}, draft:{...}}` if nonempty, or `{kind:'clean', draft:{...}}` if no
  write is needed. Do not resend unchanged local fields over remote-only edits.
- Inputs stay unmodified; output draft/patch/arrays are detached. The helper
  makes decisions only: it never sends a write or performs a retry.

Correctness and these preconditions are mandatory at every response length.
If you explain a safe retry briefly, preserve the semantic-overlap-before-retry
condition, latest-draft retention, actual tests and material uncertainty.
Do not invent API validation rules, claim tests prove all possible production
behavior, change permissions, install, delegate, commit or publish.

## How to test

1. Send the prepared shared message for plans. Review each plan in its pane.
2. Give both agents the same implementation instruction. Handle task-local
   command approvals in each pane; Allow once is approval for that one command.
3. Ask both: “Check your tests, then explain how the latest draft and conflicting
   edits stay safe.” Request corrections if either answer/code loses a condition.
4. Optionally time each review separately and report effort/interruptions after
   evaluating the work. We measure acknowledged messages/characters/approvals
   separately from subjective interruptions, and native calls/tokens/time.

Presence on the right may reduce optional commentary or change explanation depth
according to actual eligible guidance. Essential decisions, errors, approvals and
correctness remain visible. Fallback is ordinary behavior. No policy change,
resource saving or human benefit is assumed; report only what happens.
