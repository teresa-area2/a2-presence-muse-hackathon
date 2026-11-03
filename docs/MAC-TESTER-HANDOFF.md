# Peña and Mauro: Mac rehearsal

Use the [public project source](https://github.com/teresa-area2/a2-presence-muse-hackathon)
and start from a fresh clone. The private development-history repository is not
the tester checkout.

Your goal is to complete a small coding conversation with two Muse agents and
return a result package plus your experience. Use the nonconfidential samples;
avoid sensitive text or code in this rehearsal. A neutral policy, similar answers,
a failed check or a setup failure is useful feedback; do not try to manufacture a
Presence effect. Fresh independent account/setup and real coding/typing remain
rehearsal gates, not already verified outcomes.

## 1. Set up your own Mac and Muse account

Follow the [first-time quickstart](JUDGE-QUICKSTART.md#1-connect-your-own-muse-account)
for Git, Node **22.12+ within Node 22**, the reviewed Muse versions and official
Muse installation/sign-in. You need your **own entitled Muse account**: an active
Muse Code plan connected by onboarding or your own authorized API billing/credits.
A separate API key is not universally required. OP access includes neither
Muse access nor credits. Both coding agents use your allowance; an optional
Observer assessment uses separate model usage. Do not assume the test is free.

The isolated sessions require Muse's readable stored auth file. Use the quickstart's
file-existence check; do not print the file, copy another person's login, extract
Keychain credentials or put a key into the repo or feedback. If onboarding/version/
file-backed auth does not match the quickstart, stop and report the exact nonsecret
error instead of changing the protocol allowlist.

Then follow [installation](JUDGE-QUICKSTART.md#2-install-the-submitted-checkout):

```sh
umask 077
git clone https://github.com/teresa-area2/a2-presence-muse-hackathon.git open-presence-muse
cd open-presence-muse
# If you use nvm:
nvm install
nvm use
node --version
MUSE_NO_AUTO_UPDATE=1 muse --version
git rev-parse HEAD
npm run judge:install
```

Record those version/commit outputs. The intended judge package contains the
designated OP-only file; do not send its contents. `judge:install` is designed to
install locked Cipher versions anonymously without reading that file or npm tokens.
Their public availability and a clean install remain pending verification. The
prior public-judge npm token was revoked on 3 November. The OP client cutoff is
the start of **15 November UTC**; expiry does not delete saved records.
Stop on installation failure; use the quickstart's specific recovery guidance.

## 2. Read the notice and choose typing consent

Read [Privacy & Data Use](PRIVACY-DATA-USE.md) and
[access details](../judge-access/README.md) before enabling capture. OP receives
minimized key timing/category/session/time metadata from this textbox, including
before Send; this client does not send composer text in its OP payload. Metadata
is not anonymous. This demo deliberately shares one retained calibration subject
across Teresa and testers: a participant can affect later normalization. This does
not mean coding conversations are shared between testers. The owner reports
population calibration described as anonymized; linked underlying records are not
anonymous. According to the owner, a removal request to **developers@area2.ai**
covers the **whole shared demo evaluation dataset and its calibration contribution**,
not one named tester's records alone. Execution has not been independently tested. The owner reports no enforced fixed
retention or routine automatic deletion. Completion time and treatment of logs/
backups remain unconfirmed. The request excludes unrelated Area2 datasets and has
no guaranteed deadline. Expiry is not deletion.

Coding messages, task context and tool results go separately to Meta/Muse.
**See Presence impact** is optional and sends selected recorded exchanges/work
context to Muse; read its disclosure before using it. No Observer action is needed
to finish this rehearsal.

If you agree to textbox metadata capture:

```sh
chmod 600 judge-access/temporary-credentials.json
npm run judge:start -- --consent-typing
```

Otherwise omit `--consent-typing` and report that you tested ordinary fallback.
Open the printed **http://127.0.0.1:8930/** URL on the same Mac. Keep one workspace;
if the port is occupied, stop and identify the existing one. Do not expose a tunnel
or kill unrelated processes. Opening sessions sends no coding prompt.

## 3. Complete the first matched conversation

1. Select **Split a trip bill** and one model available to your account. Both arms
   use that same model. Open sessions and select **Both** in the composer.
2. Type normally, adding your own context, and send:
   > Read TASK.md and CONTRACT.md. Explain what is wrong with the current
   > implementation and suggest a short plan to fix it. Wait for my response
   > before changing files.
3. Read both plans. The example is Alice's €90 apartment for all three and Ben's
   €30 dinner for Ben and Cara: Ben owes Alice €15; Cara owes Alice €45. Reply to
   **Both** with your priorities and permission to implement.
4. Review any command/file approval inside its own pane. Approve only an action
   you understand. A decision is permission for that action, not proof it worked.
   If an approval is unsupported or stuck, capture the nonsecret message and report
   it; do not repeatedly click or disable safeguards.
5. Ask both a natural follow-up, for example “Explain why Cara owes €45, and show
   how you handle five cents split three ways.” You may steer during work. Escape
   interrupts work without closing sessions. To target both, focus the shared
   message box, verify **Both** is selected, then press Escape. Escape from inside
   a terminal pane targets that pane instead. Record any different messages,
   decisions or interruptions between arms.
6. Once both finish, reselect **Both** before **Check code** so both arms are checked;
   clicking a pane can have changed the selection. If checks fail, keep **Both**
   selected for **Send CI feedback** to send each agent its own repair results; this
   consumes model usage. Check again afterward. Unavailable checks are not passes.
7. Record whether the Presence reading/request status changed and what you actually
   noticed in the replies or optional updates. A reading is not proof of benefit.

For more coverage, export this pair, close it, choose another predefined task and
open a fresh pair. Try the remaining prepared tasks if your allowance permits;
**Your own task** is optional, starts clean and has no frozen acceptance suite.
Keep the same task/model and shared instructions within a matched pair. Do not
read the reference solution or facilitator checks into either agent's context.

## 4. Save and return results, then stop

Before closing each pair, open **Testing and diagnostics**:

- Complete **Effort and experience** only after you can judge the whole pair;
  leave an answer unknown if you cannot assess it.
- Click **Export evidence package**. Leave quoted public excerpts off unless you
  deliberately want them included. Export makes no new model call.
- Confirm the reported save result and locate the new JSON under the checkout's
  `.local/evidence-packages/`. Open the JSON locally in a text editor to confirm it
  is readable and belongs to this run; this is not a session restore/import.
  Inspect it before sharing. Assessment narrative or optional excerpts can contain
  task details even though full transcripts and work-file contents are excluded.
  If saving is not confirmed or the file is absent, report the error as a failure.
- Return one JSON per task pair directly to Teresa through your agreed private
  channel, plus the short note below. Do not put raw exports into Git or public
  issues, and do not send credentials, raw typing, Capsules or auth-file contents.

Feedback note:

```text
Tester / macOS / Node / Muse version / Git commit:
Task and selected model:
Typing consent enabled? First real OP reading observed?
Setup, approvals, steering, checks and export: what worked / failed?
Check-code result per arm (or unavailable):
Any different messages, decisions or interruptions between arms:
What was easier/harder with Presence? No difference is a valid answer.
Exact nonsecret errors and evidence filename(s):
```

Use **Close sessions**, then Ctrl-C in the launch terminal. This stops future
capture and removes temporary configuration on confirmed normal cleanup. An
in-flight request can still finish; stopping does not delete saved local/upstream
records. Keep the evidence files for recovery; native conversations do not resume
from an export. See the [quickstart](JUDGE-QUICKSTART.md) for known limits.
