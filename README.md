# Open Presence × Muse

A side-by-side coding workspace for exploring how temporary Open Presence guidance can shape collaboration with Muse Code. Two isolated Muse sessions work on the same task; eligible Presence guidance is supplied only to the **With Presence** session. You can talk to either or both, review native approvals, steer a running turn and compare the resulting work and reported resources.

Presence is the focus of the experiment. The workspace can adjust optional commentary and suggest an appropriate response presentation when guidance is available. Essential answers, errors and approvals remain visible. When guidance is unavailable or withdrawn, the Presence session uses ordinary fallback. The Pulse displays the collaboration policy; it does not show numerical personal-state measurements.

## Comparison configuration

Both agents use isolated configurations with optional imports of personal rules
and skills from other agent configurations disabled. Task-local instructions and
skills, coding tools, questions and normal approvals remain available. Your normal
Muse settings files are not edited.

If your everyday Muse setup relies on those imports, this workspace can behave
differently. **Without Presence is the configured comparison baseline**, not a
copy of your complete everyday Muse environment. Applying the same isolation to
both agents supports the comparison; it does not establish equivalent experience
or results in a differently configured environment.

For everyday Presence-enhanced Muse, the recommended direction is to preserve the
user's chosen configuration and add Presence alongside it. That separate mode is
not implemented or qualified in this submission.

## Event-built work and reused foundations

The event-period work is the Muse-specific interactive experience, UI adaptation
and current Presence/coding/evidence integration. An earlier Area2 comparison demo
was a visual reference. The selected Agent Lab/Pulse and Capsule validator files
are actual imported code, with exact pins and notices; the Lab snapshot contains
both earlier foundations and later refinements. Cipher, OP inference and Muse
remain external. See [provenance](docs/PROVENANCE.md) and
[dependency scope](docs/DEPENDENCIES.md); the disclosures do not decide eligibility.

## Try the demo

**Peña and Mauro: [start with the Mac tester handoff](docs/MAC-TESTER-HANDOFF.md).**
It covers setup, your own Muse login, the first test and returning results.

Before enabling textbox Presence, read [Privacy & Data Use](docs/PRIVACY-DATA-USE.md).
It distinguishes OP metadata, Meta/Muse coding and optional Observer requests,
consent and saved evidence, with upstream terms still awaiting confirmation.

Follow the [complete first-time judge quickstart](docs/JUDGE-QUICKSTART.md) from
a fresh checkout. You need Git, Node22.12+ within Node22, a reviewed Muse Code CLI
and your own authorized model usage. An active Muse Code plan connected by browser
onboarding is one route; your own stored Model API key with billing/credits is
another. A separate manually created key is not always required. This harness
requires Muse's readable stored auth file; environment-only keys and Keychain-only
login are not qualified for these isolated panes.

The designated `judge-access/temporary-credentials.json` supplies temporary Open
Presence access, not Muse access. The current file is OP-only; normal installation
does not read it and needs no npm token. The coordinator verified that the user’s
cleanup at `44be3b1` left the OP fields unchanged; Git history was not purged.
The installer fetches the public Cipher lite packages anonymously through locked
npm aliases. A fresh empty-cache installation and the normal judge installer
passed locally on 3 November; see [qualification status](docs/STATUS.md). After
following the quickstart's account and prerequisite steps:

```sh
npm run judge:install
# Before a consented live Presence session:
chmod 600 judge-access/temporary-credentials.json
npm run judge:start -- --consent-typing
```

Open **http://127.0.0.1:8930/**, choose a task/model and open both sessions. Opening
sessions sends no model task; Send uses the judge's own allowance. Account login
or a readable credential file does not itself prove valid model access.

The prior npm token was revoked on 3 November 2026; normal installation no longer
uses it. OP is owner-reported to expire 15 November 2026 with the launcher's
conservative UTC cutoff. The owner reports a
retained calibration subject shared across Teresa and testers; local session IDs do
not isolate it. Scope, dated grant expiry and deletion limits are in
[judge access](judge-access/README.md) and [Privacy & Data Use](docs/PRIVACY-DATA-USE.md). The separate
Mac collector is not required: explicit consent enables timing metadata from the
app textbox. Without consent, the workspace uses ordinary fallback.

The exercised local path is macOS on Apple Silicon. Linux and Windows/WSL have
specific, incomplete qualifications; see [platform support](docs/PLATFORM-SUPPORT.md).
Native Windows harness launch is unsupported, even though Muse Code itself has
a Windows CLI. A fresh independent judge's login/coding/OP journey remains open.

Use a trusted personal machine: local processes able to reach the loopback port
can obtain the browser bootstrap token. Host/Origin checks do not authenticate
local OS users. See the [local trust boundary](docs/JUDGE-QUICKSTART.md#local-trust-boundary).

## Work and compare

Choose one of the five [sample coding tasks](coding-tasks/README.md), or **Your own task** for a clean workspace. Each agent has a separate worktree. Start with a plan, respond to each agent, review any approval in its own pane and ask for changes. You can steer a running agent with a follow-up; Escape interrupts selected active work without closing the sessions. **Close sessions** ends both. Preserve an open comparison before restarting the backend: saved evidence does not restore native conversations.

For the supplied tasks, **Check code** runs the public and frozen checks in an available sandbox. **Send CI feedback** is a separate, explicit model action. Your own task has no frozen acceptance checks. A failed or unavailable sandbox is not a pass and is not replaced by unsandboxed execution. See [setup](docs/SETUP.md#native-approval-review) for approval and safety details.

The resource view reports cumulative usage where available. Output can include reasoning and tool-call arguments, not just visible replies. A count or difference alone does not establish a human benefit, causal saving or billing total. The optional observer uses a separate model call only when requested; selected exchanges and work files can contain private data or embedded credentials. Review the [observer disclosure](docs/OBSERVER-REPORT.md) before using it.

## Offline checks and evidence

After the authorized dependency setup:

```sh
npm run check:setup
npm run test:offline
npm run test:tasks
npm run demo:offline
```

The offline replay uses declared fixtures, not human typing or a live model. The local evidence package combines the checkpoint and available assessment, with explicit omissions and separate observer usage. It may contain private task information and stays in the ignored `.local/` directory. See [evidence package setup](docs/SETUP.md#combined-evidence-package) and [current qualification limits](docs/STATUS.md).

The UI export stays private. A separate `npm run evidence:public -- --input /absolute/path/to/package.json` creates a closed, redacted review copy directly under `evidence/runs/`; see the [evidence guide](evidence/README.md). It does not commit, publish or run a model. No real-run exports are included in this candidate.

The selected [Agent Lab/Pulse](vendor/agent-lab/NOTICE) and [Capsule validator](vendor/capsule-validator/NOTICE.md) are reused foundations, not newly built models. Cipher remains an external npm dependency; Muse Code and OP inference are external services. See [dependency scope](docs/DEPENDENCIES.md) and [provenance](docs/PROVENANCE.md).
