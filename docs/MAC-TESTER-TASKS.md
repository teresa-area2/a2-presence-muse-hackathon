# Mac task battery and returning results

For the two internal Mac testers. First complete the
[setup and trip-bill walkthrough](MAC-TESTER-HANDOFF.md) at the exact qualified
GitHub commit supplied by Teresa. Record that full commit for every result; older
private rehearsal tags do not identify this release.
Aim to try **all five prepared tasks**, one fresh comparison at a time. Your own
task is optional afterward. Pause between tasks if needed; more tasks mean more
real usage on your own Muse account. Report failed, blocked or untried tasks too.
Do not keep retrying setup or a stuck task just to produce a success.

## Tasks and order

Use **Spark 1.3 for both agents** throughout the main battery if your account permits it. If your account
cannot use it, report the access problem before substituting a different model.
Any agreed model change is a separate, labelled comparison.

| UI task | What you are building | A useful follow-up after implementation |
| --- | --- | --- |
| Split a trip bill | Settle shared expenses fairly using integer cents | Why does Cara owe €45? How are five cents split three ways? |
| Save conflicts | Preserve the latest unsaved edit when saving conflicts | Walk through a conflicting save and explain what happens to the latest draft. |
| Booking rules | Handle capacity, repeated reservation requests and cancellations | Explain how duplicate requests and cancellation affect remaining capacity. |
| Batch import | Keep valid customer rows and report invalid rows | Show a mixed-validity example and explain which rows are kept. |
| Notification routing | Add quiet hours while preserving existing routing behavior | Explain which routing rules stay unchanged and how quiet hours interact with them. |

Tester A: Trip bill → Save conflicts → Booking rules → Batch import → Notification
routing. Tester B: Trip bill → Notification routing → Batch import → Booking rules
→ Save conflicts. The different order reduces a shared ordering bias; two internal
testers still do not establish a general causal effect.

## Repeat this loop for each prepared task

1. Confirm the previous task's export is saved before ending that comparison.
   Use **Close sessions**, choose the next task/model, then **Open sessions**.
   Keep the local server running. Do not reuse a previous task's agent history.
2. Select **Both**. Type naturally and send:

   > Read TASK.md and CONTRACT.md. Explain the problem and propose a short plan.
   > Wait for my response before changing files.

3. Read both plans, then send the same implementation instruction to Both:

   > Go ahead with the implementation and useful tests. Keep the contract unchanged.

4. Review task-local approvals independently with the same standard. Ask ordinary
   questions when you need them; answer a native question in its own pane or use
   **Reply in message box** with that one agent selected. Record unequal sends/
   decisions rather than hiding them. A scripted win or a forced policy change is not the objective.
5. Once both are Ready with no pending question/approval/turn, select **Both**
   and use **Check code**. If needed, use **Send CI feedback**
   to send each agent its own results, allow the repair, then recheck. Before
   **every Check code or Send CI feedback**, wait until both are Ready and reselect
   **Both**. Record failure or unavailable checks honestly; a model's passing claim is not a harness pass.
6. Ask the suggested follow-up, or a natural question about that task, to Both.
   Note whether the right side was easier, harder or the same to follow. Stable
   guidance, ordinary fallback and no noticeable difference are valid results.
7. After **every follow-up**, including an explanation-only turn, wait until both
   are Ready, reselect **Both**, and run **Check code** again. Each new turn makes
   earlier check results stale. Record current final results for both arms.
8. In **Testing and diagnostics → Effort and experience**, optionally enter each
   side's effort rating (1 low–5 high) and interruptions noticed. Use **None** only
   if you actually noticed none; leaving it blank means unreported. Stop any active
   review timer. Wait for **Recorded for this pair.** after your last rating.
9. Export as below **before Close sessions or switching to the next task**.

Save the primary comparison before optional one-sided steering/interruption tests.
Those later actions can make the histories different. If you also export them,
label that snapshot separately; do not count two snapshots as two independent runs.

## Export one package per task

1. Wait for the coding/checking turn and your ratings to settle.
2. In **Testing and diagnostics**, leave **Include quoted public excerpts** unchecked
   initially, then click **Export evidence package**. This makes no model call.
3. Wait for **Saved: /…/.local/evidence-packages/<package-id>.json**. A disabled
   button, error or “a file may exist” message is not a confirmed successful export.
   If newer evidence is reported, the saved file is an earlier snapshot; export
   again only if you want the later settled state, and label which one is final.
4. Find that exact JSON file. On Mac, copy its path from the Saved message; in
   Finder press **⌘⇧G** and open the containing folder (the path up to the final
   slash). Alternatively, in a second Terminal window use `open -R` with the full
   saved path in quotes. Keep the original filename and contents unchanged.
5. Copy it into a private results folder with a task subfolder. Add one short note
   using the [feedback template](TESTER-FEEDBACK-TEMPLATE.md). Keep raw results out of Git; Teresa separately chooses any reviewed public evidence.

Suggested folder layout:

```text
Tester-A-results/
  01-shared-expenses/
    <package-id>.json
    feedback.md
  02-save-conflicts/
    <package-id>.json
    feedback.md
  ...
```

The package records a run ID, session generation and checkpoint revision. Task/model
metadata, available per-arm usage, action counters, ratings, policy/request history
and check summaries support later analysis. Counts/histories can be partial or
unknown; the export labels those limits. Its task source commit is not necessarily
the harness release commit, so include the full `git rev-parse HEAD` value supplied by Teresa in your note separately.

**Full answers and code are not in this export.** The first export should precede any optional Observer assessment, so it has no
generated assessment or selected answer quotes; ticking the excerpts option does
not create them. An optional later assessment is a separate explicit model call
and needs a separately labelled export. For a useful qualitative example,
add a few non-sensitive lines or an optional cropped screenshot of the same turn
from each side to your private note. Exported metadata and any assessment can still
identify a task/person; inspect the files before sharing. Do not include credentials,
raw typing, confidential source or native logs.

## Optional Your own task

After exporting the prepared tasks, choose **Your own task** and open a fresh pair.
It starts with a clean workspace; it does not attach your existing project. Give
Both the same small, non-sensitive goal and define what success means before
implementation. Do not ask the agents to read TASK.md/CONTRACT.md in this empty
workspace. Continue as a real conversation and label the export `free-task` with
your goal and acceptance criteria in the note.

This mode has no predefined frozen suite: **Check code/Send CI feedback are not
available**. Agent-authored tests or passing claims are self-reports until separately
verified. Keep this exploratory result separate from the scored prepared tasks.

## Return the results

After each task, send the task folder through the same **private channel** agreed
with Teresa for the handoff. You can also collect your folders, right-click the
parent in Finder, choose **Compress**, and send one ZIP after your session. Please
send the first task's result early so an export problem can be caught before the
remaining tasks. For blocked tasks, send the safe error and short note even if
no export could be created; list tasks you did not reach.

The app saves locally and **does not upload results automatically**. Do not put
packages, screenshots or notes in GitHub issues, commits or a public link. Teresa
can use the exports for resource/quality/mechanism analysis and the notes for
human experience; neither alone proves that Presence caused a benefit.
