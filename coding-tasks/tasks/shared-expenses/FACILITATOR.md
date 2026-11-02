# Facilitator only — Split a shared trip bill

## The person-facing story

“We went away together. Alice paid €90 for the apartment. Ben paid €30 for dinner, but only Ben and Cara ate. What does everyone owe now?” Explain that euros are stored as integer cents. The desired answer is Ben pays Alice €15 and Cara pays Alice €45. The coding task is the calculation behind an ordinary expense-sharing app, not building a complete app.

Ask the tester to read the task, send the same plan request to Both, review each plan, then ask both to implement and run the public tests. They can approve commands in the appropriate pane, interrupt work, or reply normally if an agent asks a genuine question. Do not script questions, Presence policies, response lengths or a successful result.

## A meaningful follow-up

After seeing the first result, ask both: “Cara says she paid nothing but joined both expenses. Walk me through why she owes €45, then show what happens to a five-cent bill split three ways. Add a public regression for that rounding example if it is missing.” This stays inside the fixed contract and lets the person assess explanation, usefulness and rework instead of guessing at internal code quality.

A further real product discussion could ask whether alphabetic remainder assignment feels fair over many trips. Do not silently change the fixed rule: a rotating remainder policy, currency conversion, percentages, debt optimization, UI or persistent storage needs a new agreed contract and checks. It is an unscored extension until then.

## Independent checks and fair comparison

Copy ONLY `project/` into each fresh isolated agent workspace. Exclude this guide, `checks/`, `reference/`, previous candidates, evidence, credentials and typing. The full fixed behavior is public in `project/CONTRACT.md`; frozen checks add examples, not secret product requirements.

Run `TASK_PROJECT_DIR=/absolute/path/to/candidate node --test checks/acceptance.test.mjs` from this task directory. Without the override, the check imports `../project/src/settle.mjs`; paths containing spaces are supported. The incomplete starter should pass its smoke test but fail expense acceptance. The private reference must pass the same checks and the public behavior tests. Passing fixtures are limited evidence for the stated cases, not production readiness.

Use the same initial snapshot and instructions for a matched pair. If the person chooses different follow-ups or answers, preserve them and mark the conversation histories divergent. Record their actual actions/experience separately from coordinator simulations, agent resources and verification time. One comparison does not establish causal or general Presence benefit. A free-form task is welcome separately, but without a frozen contract it has no equivalent automatic acceptance claim.

## Video suggestion

Show the trip example and the two working agents; ask for a plan, approve an implementation, run the explicit code checks, then send each its own actual CI feedback if needed. Use the rounding/explanation follow-up as a real conversation. Show current input delivery, native conversation and any observed presentation hold/release separately. Do not manufacture a policy change or narrate unmeasured savings.
