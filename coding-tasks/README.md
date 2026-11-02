# Coding task battery v1.0.4-draft

Five synthetic JavaScript projects for internal and multiuser coding comparisons. Node.js 20 or later; no network or packages required. Each directory has a participant-facing `project/`, facilitator-only `FACILITATOR.md`, private `checks/`, and a private `reference/` for testing the verifier. Each short `TASK.md` gives the outcome; `project/CONTRACT.md` gives the complete fixed behavior. Facilitator checks add examples of that public contract, not secret requirements.

## Fair, independent runs

For each participant and arm create a new empty workspace and copy **only** the selected `project/` directory into it. Match the initial snapshot and prompt; use the same subsequent instructions when comparing effects. Keep `checks/`, `reference/`, facilitator notes, other participants' work, real typing, Presence records and credentials outside both agent snapshots. Never reuse state or authentication across participants. Model, provider, time, context, guidance availability and any divergence must be recorded. A single pair is exploratory. Mark simulated runs and human interactions accurately.

## Conversation protocol

1. **Plan and review:** Ask both agents to read `TASK.md` and `CONTRACT.md`, propose a short plan, and wait. Review their plans and share actual priorities, constraints or tradeoffs that matter to you; no agent should invent a decision or force a question.
2. **Implementation and approvals:** Give both the same implementation instruction for a matched comparison. Review and handle each approval yourself in its pane. A refusal or interruption is a valid observation.
3. **Inspect tests:** Ask each agent what it changed and how it tested the public contract. The facilitator runs the separate acceptance checks on each candidate. Discuss any failing cases.
4. **Natural revision:** Choose one follow-up from the facilitator guide or a real requirement or review comment. Contract-changing follow-ups are separate and unscored unless a new agreed contract and checks are supplied. Ask both the same question for a matched comparison. If you send different messages or make different decisions, label the histories divergent; do not treat their results as a controlled comparison.

Use the user's own meaningful requirements and tradeoffs where possible. A shared request allows comparison; individual interaction is welcome but changes the histories. Record human actions and agent actions separately, mark simulated vs human steps and unavailable evidence, and avoid inferring a benefit from one pair.

## Offline verification

From this directory, run `node verify.mjs`. This checks every starter's smoke test, expects each acceptance suite to fail on the intentionally incomplete starter, and requires each independent reference to pass the same acceptance suite. To assess a participant candidate, set `TASK_PROJECT_DIR` to its absolute directory when invoking that task's acceptance test. Never give private verifier code or references to the agents during the test. The local verifier executes candidate code and assumes it is trusted; it is not a production sandbox for arbitrary multiuser submissions. Use separately isolated participant workspaces and an appropriately secured execution environment before running untrusted submissions. Passing tests covers specified cases only, not security, production readiness or human benefit.

## Video recommendation

Primary: **save-conflicts**. In about three minutes, explain that the user and a collaborator edited a task, ask both agents for a plan, then choose a real tradeoff such as whether a same-field conflict needs explicit resolution. Review and approve an implementation, inspect the tests, and offer a brief revision or question. A contract-changing revision is unscored unless separately specified and checked. Show source reading, policy decision and observed hold/release action as separate evidence when available; don't script or imply a successful outcome. Keep the initial task and requests matched for a fair baseline.

Reserve: **batch-import**. Review a mixed batch and ask about partial success; give both agents the same feedback about a rejected row followed by a valid one, then inspect the checks.

## Contract coverage

Save-conflicts checks include preservation of caller-owned drafts when a client normalizes a request, returns an error or reports a conflict. Recovery must preserve pending fields, remote-only fields, the fetched revision and the single-retry limit. Frozen facilitator checks remain separate from each agent's workspace. Fixture checks cover examples of the public contract; they do not establish a later agent's correctness or human benefit.

## Relatable sample and your own task

**Split a trip bill** (`shared-expenses`) is the new judge/tester-friendly sample:
friends paid for an apartment and dinner, not everyone shared every expense, and
the group needs to know who pays whom. The facilitator guide supplies a worked
€90/€30 example and a natural rounding/explanation follow-up. Correctness is fixed;
conversation and explanation can vary. Public behavior tests and separate
facilitator acceptance cases are provided. Verifying the reference qualifies the
fixture, not a later participant solution.

**Your own task** is separate from the frozen sample battery. On each Open, both
agents receive new isolated workspaces with only Node package metadata, a README
and harness instructions. Describe what to build or fix; no sample solution or
previous conversation code travels. There are no frozen acceptance claims in this
mode; ask Muse to write/run appropriate tests and review its result. Choosing a
mode replaces only an untouched suggested prompt, preserving an authored draft.
