# Redacted recorded comparisons

Files in `runs/` are intentionally prepared, redacted snapshots of real comparison runs for review. They omit original run and reading IDs, timestamps, messages, code, raw typing, Capsules, ratings and private narratives. Presence controls are still sensitive context: pseudonymization is not anonymity.

A public record's SHA-256 identifies its own bytes. A separately labelled original-package digest is a commitment to a withheld private original and cannot independently verify that private original from this repository. A reported harness fingerprint or task-source commit does not prove the deployed server or browser bytes. Unknown or unverified evidence remains unknown; observed guidance does not prove model compliance, human benefit or causal savings. Recorded checks cover only their stated test cases.

Create a local reviewable file with `node scripts/export-public-evidence.mjs --input /absolute/path/to/private-package.json`. The command writes only to this checkout's `evidence/runs/`; it does not commit, publish or run a model. Inspect the redacted record before sharing.
