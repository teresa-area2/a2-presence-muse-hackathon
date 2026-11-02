# Facilitator only — Review and repair a partial batch import

Facilitator review cue after implementation: “A reviewer says the first invalid row might prevent a later valid row with the same email from being imported. Check the behavior and explain it.” Optional change request: report duplicate indexes; agree on its contract separately. No production customer data.

Use the same project snapshot and initial brief for each arm. Do not include this file, `checks/`, or `reference/` in agent workspaces. These are synthetic fixtures; use fresh independent copies for each arm and participant. Run acceptance checks against the candidate with `TASK_PROJECT_DIR=/absolute/path/to/candidate node --test tasks/batch-import/checks/acceptance.test.mjs`. A passing check covers only the public fixed contract in `project/CONTRACT.md`. Optional contract-changing follow-ups are separate and unscored unless new checks are supplied.
