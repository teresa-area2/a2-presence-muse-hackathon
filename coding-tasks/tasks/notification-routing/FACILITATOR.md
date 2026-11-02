# Facilitator only — Refactor notification routing safely

Natural tradeoff: “Should an urgent event bypass user opt-out as well as quiet hours? Explain the safety and product implications before changing behavior.” Fixed contract says no. Follow-up: ask for a smaller public surface without changing behavior.

Use the same project snapshot and initial brief for each arm. Do not include this file, `checks/`, or `reference/` in agent workspaces. These are synthetic fixtures; use fresh independent copies for each arm and participant. Run acceptance checks against the candidate with `TASK_PROJECT_DIR=/absolute/path/to/candidate node --test tasks/notification-routing/checks/acceptance.test.mjs`. A passing check covers only the public fixed contract in `project/CONTRACT.md`. Optional contract-changing follow-ups are separate and unscored unless new checks are supplied.
