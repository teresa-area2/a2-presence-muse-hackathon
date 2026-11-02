# Try Open Presence × Muse

Start from a fresh clone on your own Mac. Record the commit and your Muse version
with your feedback. Current verification limits are listed in [STATUS](STATUS.md).

The intended judge route is a **local macOS workspace**, using the judge's own
authorized Muse account. Linux and Windows via WSL2 are additional implementation
targets; their current verification status is listed below. The browser is the interface; a local server runs two real
Muse Code sessions. A static website alone cannot run them. There is no hosted
judge service or shared Meta account in this submission.

Before account setup, install Git and Node **22.12 or later within Node 22** (`.nvmrc` pins 22.12.0), and
Meta's Muse Code CLI. Native protocol startup, steering and interruption were
checked with **1.4.13 / R6996.1** and **1.4.14 / R7309.1**. The full real-model
coding/Presence qualification remains on 1.4.13; 1.4.14 still needs the hands-on
coding/OP rehearsal. Other schema fingerprints refuse before sessions open. This
project does not redistribute Meta's binary. The harness uses Unix process groups,
private Unix files and local sockets. Native Windows launchers refuse before loading
credentials or starting a workspace; use the WSL2 route below. **Check code** uses
Apple's sandbox on macOS, or an optional Bubblewrap sandbox on Linux. Missing or
denied isolation leaves checks unavailable; generated tests never run directly on
the host as a fallback. See [platform verification](PLATFORM-SUPPORT.md).

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

Earlier exports retain their original source/configuration identity. The current
explicit isolation must not be assumed to have applied to older runs, nor should
older results be relabelled as results from this build.

## 1. Connect your own Muse account

You need **one** authorized Muse billing route, not necessarily a separately
created API key:

| Route | What you supply | What to verify |
| --- | --- | --- |
| Muse Code subscription/onboarding | Your own Meta account and an available active Muse Code plan | Onboarding connects its Muse Code credential; confirm the selected model and remaining plan allowance |
| Meta Model API pay-as-you-go or approved credits | Your own authorized API key, with billing/credit and model access | Additional manually created keys use API billing, even if you also have a Muse Code subscription |

A Meta account sign-in by itself does not establish either route. The included
OP/Cipher access supplies neither Muse entitlement nor model usage. Both coding
agents consume your own allowance; the optional Observer uses separate model
usage. See Meta's [authentication](https://dev.meta.ai/docs/muse-code/auth),
[subscription](https://dev.meta.ai/docs/muse-code/subscriptions) and
[API billing](https://dev.meta.ai/help/billing/set-up-billing) documentation.

Install Muse from [Meta's official instructions](https://dev.meta.ai/docs/muse-code):

```sh
curl -fsSL https://dev.meta.ai/install.sh | sh
MUSE_NO_AUTO_UPDATE=1 muse --version
MUSE_NO_AUTO_UPDATE=1 muse --contributor-mode off
```

Use the first-run browser sign-in or `/login` inside that standalone session.
Finish account onboarding, then leave it without sending a coding prompt. The
harness also forces contributor mode off for both isolated agents.

If you deliberately choose your own API-key billing route instead, create the key
in your Meta Model API account and store it through Muse. This Bash prompt keeps
the key out of shell history, command arguments and the visible input:

```sh
bash -c '
  set -o pipefail
  IFS= read -r -s -p "Your own Meta API key: " judge_muse_key || exit 1
  printf "\n" >&2
  test -n "$judge_muse_key" || exit 1
  printf "%s" "$judge_muse_key" | MUSE_NO_AUTO_UPDATE=1 muse auth set --api-key-stdin
  judge_muse_status=$?
  unset judge_muse_key
  exit "$judge_muse_status"
'
```

If storing authentication reports an error, stop: an older readable auth file does
not establish that the intended new account/key was saved.

Never use another person's key or put a Meta key in this checkout, the Area2 access
file, chat, screenshots or the app's message box. Do not create an extra paid API
key merely because a subscription browser login needs troubleshooting.

### Check the harness-specific credential location

The isolated sessions currently require Muse's existing file-backed credential.
Check only that it is readable; do not print or edit it:

```sh
if test -r "${XDG_CONFIG_HOME:-$HOME/.config}/muse/auth.json"; then
  echo 'Stored Muse credential file is readable; entitlement is not yet tested.'
else
  echo 'STOP: file-backed Muse login unavailable. Report this before opening sessions.'
fi
```

The harness references that file from each private arm; it does not copy it into
the repository. It removes `META_API_KEY` from the child environment, so exporting
that variable alone will not authenticate these panes. A Keychain-only login has
not been qualified here. If the file check fails, stop and report it; do not extract
Keychain secrets, invent an auth file or bypass the check. A present file still
does not verify valid credentials, billing or model access.

After onboarding, run `MUSE_NO_AUTO_UPDATE=1 muse --version` again.
The reviewed Muse versions are **1.4.13 / R6996.1** and **1.4.14 / R7309.1**.
The official installer can supply a newer build. If the version or schema is not
reviewed, report it rather than changing the protocol allowlist. The harness
disables auto-update for its spawned processes. Fresh judge browser login and
subscription-backed use remain to be observed; existing-account checks are not
that qualification.

## 2. Install the submitted checkout

Use the actual repository/access package supplied with the submission. The
maintainer's designated `judge-access/temporary-credentials.json` supplies the
temporary access to private Cipher packages on npm and to OP. A normal development clone intentionally
does not commit this file; if it is absent, request the completed judge package or
use `--access /absolute/path/to/the/supplied-file.json` after the command's `--`.
Do not substitute unrelated production credentials.

```sh
# Clone into a private local directory. Git does not preserve owner-only file modes.
umask 077
# Accept your invitation to this private repository first.
git clone https://github.com/teresa-area2/a2-presence-muse-hackathon.git open-presence-muse
cd open-presence-muse
chmod 600 judge-access/temporary-credentials.json
# If you use nvm:
nvm install
nvm use
npm run judge:install
```

The command performs the locked Cipher install without dependency install scripts,
builds the browser bundle, and checks the Node/dependency setup. It uses a temporary
owner-only npm configuration, removes it before build/check, and leaves your normal
npm configuration unchanged. Cipher remains a private npm dependency; no Cipher
source archive, `node_modules` or compiled browser bundle is committed.

Temporary **Cipher installation access expires 10 November 2026 at 19:24:02 UTC**.
Already downloaded package files do not disappear at expiry. An already installed
copy does not need registry access every time it starts. New installation after
expiry requires renewed authorized package access.

### Installer recovery

On a normal failure or catchable Ctrl-C, termination or terminal hangup, the
installer waits for its owned npm process group to stop before removing its
temporary configuration. Build/check steps receive no copied npm credential.

`judge_access_cleanup_unconfirmed` means installation failed because the owned
process group's termination is uncertain. No later build/check steps run. The
helper deliberately withholds cleanup to avoid racing that uncertain process;
the error names its originally allocated directory for checked recovery. It was
created owner-only (0700, with npm config0600), containing the copied npm
credential rather than an OP secret. That path is not proof of its current
identity or permissions. Do not immediately start another installation.

`judge_access_cleanup_failed` means no owned process has unconfirmed termination,
but file cleanup failed or the directory's identity changed. A process may never
have started. This also stops installation; no
directory is presented as a verified recovery target. Preserve the error and ask
the maintainer to inspect it rather than deleting an unverified path.

Ask the maintainer to confirm the failed attempt's process identity and exit, then
verify the reported directory's ownership and remove only that attempt's directory.
Do not kill unrelated npm/Muse processes or delete all `a2-judge-access-*` folders;
another active judge session may own one. A force-kill or OS crash can also leave
temporary files and needs the same checked recovery. Keep directory contents and
the supplied credential bundle out of feedback/screenshots.

### Local trust boundary

Run this workspace on a trusted personal machine and OS session. It binds to
loopback, but a local process or another local user able to reach that port can
request the browser bootstrap token. Browser Host/Origin checks do not authenticate
OS users or isolate the API from other local callers. The workspace does not
provide a multi-user-host security boundary.

Do not expose the port through a public tunnel or use it on a machine with
untrusted local users/processes. A remotely hosted or isolated multi-user service
would need a separately authenticated design; adding another caller-supplied
header would not provide it. No such gateway is included here.

## 3. Start with explicit typing consent

Read [Privacy & Data Use](PRIVACY-DATA-USE.md) first. The message box supplies
key timings/categories, a session identifier and time/timezone context to
Area2/Open Presence for collaboration guidance. This is not anonymous data.
Your coding messages/task context and optional Observer requests go separately
to Meta/Muse, as described in the notice. The Mac background collector is not needed.

`--consent-typing` is the local consent action: opening sessions then authorizes
capture automatically, with no additional local entry checkbox. Metadata can be
sent while you type, before Send. Choosing the Without recipient does not disable
capture; only the With agent receives Presence guidance. The Pulse represents
policy, not numeric personal measurements.

**Close sessions** or Ctrl-C stops this session's future capture. A model interrupt
is not consent withdrawal; stopping does not delete saved records or recall an
already-dispatched upstream request. For coding without live Presence, launch
without the flag. Requesting an Observer explanation/assessment is a separate action.

After reading the notice and agreeing to this typing-metadata processing:

```sh
npm run judge:start -- --consent-typing
```

Open the printed loopback URL, normally **http://127.0.0.1:8930/**. If a
`localhost` alias returns 403, use the printed `127.0.0.1` address; the Host guard
is intentional. This command never kills another workspace. If that port is occupied, use the existing workspace
or deliberately choose another port with `--port 8931`; do not run duplicate demos.
Starting the server or opening sessions sends no model task.

The owner reports that the dated Open Presence grant configuration expires at
**17:00 UTC on 15 November 2026**; current service acceptance was not freshly
verified. The launcher independently refuses the supplied OP bundle from the
start of 15 November UTC. The generated
private client configuration carries that cutoff into a running workspace: new
OP Auth/capture dispatches and subsequent guidance selections fail closed at or
after it. Retained guidance becomes ordinary fallback while Muse coding sessions
continue. A request started earlier can finish later, but its late result cannot
become eligible guidance. This is a client-clock guard, not a verified server
expiry; server-side revocation/limits can reject access earlier. This is separate from the verified npm
token expiry. The current transport uses the supplied account's `internal` mode;
the same OP credentials are intentionally supplied to judges, as confirmed by the
owner. The owner reports one retained calibration subject shared by Teresa and
testers in the 28–29 October Muse configuration: local session IDs do not isolate
norms and one participant's activity can influence later normalization. Teresa
accepts this for the demo. Quotas, current server state and deletion remain unverified.

## 4. One understandable interactive test

Select **Split a trip bill** and the same entitled model for both agents. Spark 1.3
and Wonder 1.0 are selectable; availability still depends on your Meta access.
Open the sessions. The task is an expense calculation: Alice paid €90 for a shared
apartment; Ben paid €30 for dinner shared by Ben and Cara. The intended result is
Ben paying Alice €15 and Cara paying Alice €45.

Send to **Both**, adding a short note by normal typing rather than simulated input:

> Read TASK.md and CONTRACT.md. Explain the problem and propose a short plan in
> ordinary language. Wait for my response before changing files.

Then authorize implementation and ask a natural follow-up, such as explaining
Cara's €45 or splitting five cents three ways. Approve task-local commands inside
each pane. Approval permits that displayed action; it does not certify its result.
Keep sends on Both for comparable input histories. Different questions/decisions
can make the histories different; the evidence should record that honestly.

Guidance can change on later model requests. Missing, rejected or withdrawn
guidance uses ordinary fallback. A neutral policy or similar answers is not proof
of a broken connection; inspect the reading and request-delivery evidence. Neither
delivery nor a visual difference alone establishes better work or human benefit.

**Check code** runs public and frozen checks in a separate read-only
sandbox with no host network and bounded time/output. **Send CI feedback** sends each
selected agent its own checked results for repair. On Linux it requires `/usr/bin/bwrap` and permitted unprivileged user namespaces;
`npm run check:linux-sandbox` performs a synthetic real-kernel qualification with
no credentials or model calls. An unavailable sandbox never becomes an unsandboxed
run or a passing check. Native Windows still requires WSL2.

Use **Close sessions** when finished and Ctrl-C in the launch terminal to close the
server and its temporary OP configuration. Save/export evidence before replacing
a backend; native conversations do not restore after a server restart. See the
[evidence instructions](SETUP.md#combined-evidence-package) for feedback, ratings and export.

The optional **See Presence impact** action makes a separate Muse call with
selected conversations/work files and Presence, interaction and self-reported
experience evidence. These materials can contain private information or embedded
secrets. Read the [Observer disclosure](OBSERVER-REPORT.md) and the action's warning
before using it. It remains one click; no automatic assessment or new confirmation
step is added. Observer usage is tracked separately from both coding agents.

## Linux and Windows through WSL2

For Linux, install Git and Node22.12+ within Node22, then follow the same Muse,
Cipher and consent commands above. The optional independent verifier requires
Bubblewrap from the distribution's maintained package repository. On Debian or
Ubuntu, `sudo apt-get install git bubblewrap` installs those prerequisites; the
judge decides whether to install system packages. Run `npm run check:linux-sandbox`
before relying on Check code. Exit2 means isolation is unavailable. Do not disable
host security policies or add privileges to turn that result into a pass.

Windows users need **WSL2**, not a native PowerShell/Node launch. If WSL2 is not
already installed, follow [Microsoft's installation guide](https://learn.microsoft.com/en-us/windows/wsl/install).
Within the Linux distribution:

1. Put the checkout/package in your Linux home, such as `~/open-presence-muse`,
   rather than `/mnt/c`. Keep the temporary access file private with
   `chmod 600 judge-access/temporary-credentials.json`.
2. Install and run **Linux** Git, Node22 and Muse there. Start `MUSE_NO_AUTO_UPDATE=1 muse --contributor-mode off` and use first-run sign-in or `/login` with
   your own account; open its displayed sign-in URL in your browser if necessary.
   Do not copy another person's Muse auth or Windows credential store.
3. Run `npm run judge:install`, then `npm run judge:start -- --consent-typing`.
   Open the printed `http://127.0.0.1:8930/` in your Windows browser. WSL's localhost
   forwarding must work; do not expose the server on `0.0.0.0` to work around it.
4. Stop with Ctrl-C in the same WSL terminal. Use the optional Linux sandbox check
   above; WSL2 itself does not prove the verifier can create its namespaces.

Microsoft documents [Linux-filesystem storage](https://learn.microsoft.com/en-us/windows/wsl/filesystems)
and [Windows-browser localhost access](https://learn.microsoft.com/en-us/windows/wsl/networking).
These are setup instructions, not a claim of a completed Windows/WSL rehearsal.
A successful Linux container test does not qualify WSL's browser forwarding,
Windows authentication UX or an independent judge's live OP typing.

## If access is unavailable

After Cipher is installed, `npm run judge:start` without `--consent-typing` opens
ordinary fallback with live OP off and does not read an OP credential. Real Muse
coding still needs your own entitled account. This tests fallback, not adaptation.

For a genuinely credential-free repository check:

```sh
npm run check:setup
npm run demo:offline
```

The second command runs generated synthetic textbox events through stub inference
and reports JSON. It does not use the private Cipher SDK, real OP, Muse, typing or
calibration. It checks mechanisms, not the real end-to-end product experience.
Full offline tests after installation are `npm run test:offline`.

## Hosting and verification status

A hosted version would need authenticated judge sessions, isolated native workers,
approved model/service credentials and billing, tenant separation and a reviewed
remote gateway. The existing loopback server/token is not that gateway. Do not
expose it publicly or describe a static deployment as a hosted Muse demo.

Current checked behavior and remaining rehearsal limits are in [STATUS](STATUS.md). Offline
passes, authenticated service access, real model calls and a judge's independent
sign-in/typing are separate checks. See [temporary-access handling](../judge-access/README.md)
for the current expiry/scope evidence and release boundary.
