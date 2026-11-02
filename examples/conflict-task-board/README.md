# Conflict-safe task-board saves

This exercise begins with a deliberately unsafe reconciliation helper. It reads
the draft too early and treats a fresh revision as permission to overwrite fields.
Both comparison agents start from exactly these bytes in isolated worktrees.

Run `node --test tests/contract.test.mjs`. Initial failures are intentional evidence
of the bug. Fix `resolve-conflict.mjs` without modifying the supplied contract.
No dependencies, build, network or production data are needed. Read TASK.md for
the exact opaque-revision API and required behavior.
