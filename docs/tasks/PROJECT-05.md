# PROJECT-05 — Explain Presence capture status

## What we are building

Make the existing Presence capture status understandable and actionable. A
person should be able to tell why capture is paused or unconfirmed and what to
try next, without mistaking the menu icon or an older eligible receipt for
proof that capture is active now.

## Task for both Muse agents

In this isolated project worktree, add a pure `captureExplanation(capture,
readAt, now)` helper beside the existing `captureLabel` in
`web/presence-action.mjs`. Connect its short plain-language explanation to the
existing capture status in `web/index.html` and `web/app.mjs`. Handle collecting,
waiting, unsupported field, unavailable focus, secure input, off, stale or
missing read, and unknown state. Suggest returning to a normal supported input
only when relevant; never suggest bypassing secure input or disabling safety.
A paused collector and an eligible earlier receipt may coexist. Do not infer a
person's state, claim the signal is fresh, expose private inputs, or change
capture, policy, fallback, approval, model, collector, packaging or runtime.
Keep existing status labels and comparisons working, make the explanation
keyboard/screen-reader accessible, and add focused tests in
`tests/presence-visibility.test.mjs` for current and old reads, paused reasons,
missing values and safe wording. Run the applicable tests and explain changes,
checks and limitations.

## What you will do

Send the same task to both agents. Review and answer each terminal's native
approval prompts independently. When both propose a result, ask the same
follow-up question: “What changed, how did you verify it, and what remains
uncertain?” Compare the results, not just their length. This is a real feature
in isolated worktrees; neither agent's changes are automatically merged.
