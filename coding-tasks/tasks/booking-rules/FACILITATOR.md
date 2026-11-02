# Facilitator only — Handle a policy change in event reservations

Natural follow-up: “The product manager now wants a waitlist. Sketch the policy first, including what happens to a retried request.” The fixed verifier covers the original capacity/idempotency contract only. Reserve no live seats or services.

Use the same project snapshot and initial brief for each arm. Do not include this file, `checks/`, or `reference/` in agent workspaces. These are synthetic fixtures; use fresh independent copies for each arm and participant. Run acceptance checks against the candidate with `TASK_PROJECT_DIR=/absolute/path/to/candidate node --test tasks/booking-rules/checks/acceptance.test.mjs`. A passing check covers only the public fixed contract in `project/CONTRACT.md`. Optional contract-changing follow-ups are separate and unscored unless new checks are supplied.
