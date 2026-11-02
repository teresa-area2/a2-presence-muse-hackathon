# PROJECT-06 — Presence-aware progress without missed decisions

## Goal

Help a person follow two coding agents without unnecessary interruptions.
In the Presence-enabled workspace, adapt optional progress commentary to the
currently eligible Presence collaboration policy. Make the adaptation visible
and reversible; keep essential information and the person's control intact.

## Same task for both Muse agents

Work in your isolated copy of this project. Before editing, propose a short
plan and ask the person for any decision you actually need. Wait for their
response before implementation.

Implement a small, testable presentation policy for optional agent commentary
in the structured comparison. When the Presence arm's eligible policy says to
`defer` optional updates, group or hold those optional commentary messages and
show the person that updates are being held. When the policy changes to `send`
or becomes ineligible or unavailable, release the held commentary in order.
Provide a clear manual way to reveal held commentary immediately. The baseline
arm continues to show ordinary updates and never receives Presence data.

User messages, approval requests, errors, final answers, and anything needed
for a decision must remain visible immediately. Never infer a person's state,
claim a guidance read proves model behavior, alter the collector or packaging,
automatically approve commands, or make temporary Presence data a permanent
preference. Show receipt age and distinguish current capture from an older
eligible receipt. Follow the existing consumer eligibility contract; do not
invent a new age cutoff.

Use the existing structured session and Presence projections. Add focused
regression tests covering both arms, held updates, user reveal, policy change,
ordinary fallback, ordering, and mandatory information. Run the relevant tests.
Explain what changed, what was verified, and what remains uncertain. No commits,
publication, external services, dependency installs or changes to the collector.

## How to test

1. Send the shared request for a plan and read both replies.
2. Give both agents the same implementation instruction and handle each
   approval in its own pane.
3. Ask both agents the same follow-up: “What did you change, how did you test
   it, and how can I see when Presence changes the experience?”
4. Compare whether essential information was visible, the number of optional
   interruptions, the person’s own effort, completion, and available resource
   counts. An observed difference is not automatically a proven benefit.
