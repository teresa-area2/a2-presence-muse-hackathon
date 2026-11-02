# Temporary judge access

## Where the judge access belongs

The submission candidate deliberately tracks one designated bundle at
`judge-access/temporary-credentials.json`; reuse it rather than making duplicate
credential files. It supplies only private Cipher installation access and the
intended Open Presence client. The normal development checkout ignores it. A
judge's own Muse login/key and billing/credits remain separate and must never be
added to this bundle. Follow [the complete first-time journey](../docs/JUDGE-QUICKSTART.md).

Local Git clones do not enforce private permissions: use `umask 077` when cloning
and `chmod 600 judge-access/temporary-credentials.json`. Installation uses temporary
registry configuration, removes it before build, and does not replace normal npm
settings. No credential values belong in screenshots, feedback or evidence.



The submission includes the designated temporary
Open Presence account and Cipher npm access. This directory is the explicit
exception; it never contains a Muse account, Meta key or other production secret.
Cipher package code remains a private npm dependency.

`access.example.json` is a sanitized schema example, not working access. The actual
prepared file is **temporary-credentials.json**, mode 0600 locally. It stays ignored
in ordinary development so routine commits and synchronization do not accidentally
distribute access. The final reviewed submission candidate must deliberately include
that exact file under the existing release authorization; do not broaden the ignore
exception to other credential files or display its diff/values in logs or chat.

The setup/launch commands read it directly, validate its purpose and relevant expiry,
and copy only the needed credential into an owner-only temporary file outside the
checkout. Installation removes the npm config before build/check. Live startup
requires `--consent-typing`. A launch without that flag does not read the bundle.
Confirmed shutdown/error paths remove copied configuration. Catchable Ctrl-C,
termination and terminal hangup follow the owned cleanup flow. If installer
process-group termination is unconfirmed, the install fails and withholds
automated cleanup; it reports the originally allocated directory for checked
recovery. File cleanup failure without unconfirmed process termination has a distinct error
and supplies no verified recovery target; see
[installer recovery](../docs/JUDGE-QUICKSTART.md#installer-recovery). An OS
force-kill/crash cannot guarantee cleanup. Credential values are not sent to the browser or passed
as model context by these helpers.

## Runtime cutoff enforcement

The judge's date-only OP limit is copied into its private client configuration.
At or after that cutoff, new OP Auth/capture requests are refused and subsequent
cache/Presence-hook selections use ordinary fallback, including when the person
has been reading without typing. Coding sessions and historical reading evidence
remain. Late responses from requests started before cutoff cannot restore current
guidance. No polling service or synchronous network wait was added.

This local check relies on the trusted machine's clock and supplements the
service's own authority; the owner-reported server expiry time has not been freshly verified.
Ordinary nonjudge configurations without a configured cutoff retain their existing
lifecycle. Clock-boundary checks use synthetic clocks/fetchers, not real OP calls.

## Current verified facts (1 November 2026)

- The configured Cipher token is named for the hackathon, read-only, without 2FA
  bypass, and expires **2026-11-10T19:24:02.563Z**, as returned by npm metadata.
- Its grant covers the **@area2-ai package scope**, not only the two Cipher
  packages. A public copy can download other private packages accessible under that
  scope. Before release, prefer a replacement read-only token restricted to
  `@area2-ai/a2-cipher-react` and `@area2-ai/a2-cipher-core`, or account explicitly
  for the broader disclosure. No token was created, changed or revoked here.
- Both locked private package versions were readable with the configured token.
  Authentication failure and missing versions remain setup failures, not permission
  to commit cached packages or old `node_modules`.
- Expiring/revoking registry access does not delete copies already downloaded or
  cached. Public access to the token can therefore result in retained private
  package copies after expiry; expiry is not a mechanism for recalling that code.
- OP authentication accepted the configured hackathon account and issued a
  one-hour access token. That lifetime does **not** establish the client secret's
  expiry. The owner reports the dated grant configuration expires **15 November
  2026 at 17:00 UTC**; current server acceptance was not freshly verified. Granted
  actions, quota and retention were not established by the tested response.
- The launcher's date-only cutoff is conservative: it refuses the supplied OP
  access from **2026-11-15T00:00:00Z**. The server remains authoritative and can
  reject access earlier. A completed install can start after Cipher's expiry while
  OP remains accepted; a fresh install needs current registry access.
- Muse entitlement remains separate. Judges sign in with their own authorized
  Meta account or key and use their own applicable credits/plan.

The owner reports that the 28–29 October Muse configuration uses one retained
calibration subject for Teresa and testers. Local session IDs do not isolate its
norms, and one participant's activity can affect later normalization. Teresa
accepts this shared demo configuration. The reported service records submitted
metadata and derived profiles; retention, backups and deletion remain unconfirmed.
See [Privacy & Data Use](../docs/PRIVACY-DATA-USE.md). Do not send simulated typing
to the shared live account as though it were real user input.

## Maintainer release/revocation checks

Verify the actual selected token/account, expiry, package scope, quotas, allowed OP
actions and tenant/data boundaries against service administration where available.
Keep the verification receipt private and omit values from the release checklist.
Replace overly broad access if needed. Inspect only the intended submission tree;
do not print the prepared secret file or rely on a general filename scan to clear it.

The npm owner can revoke the designated token through npm account management; OP's
owner must disable/revoke the designated client through its service administration.
Before revocation, check whether another runtime uses that same identity. This work
does not change live credentials, collectors or service administration. Publication
of the repository and submission remain the existing separate release step.

Read [Privacy & Data Use](../docs/PRIVACY-DATA-USE.md) before consenting to capture;
use [the judge quickstart](../docs/JUDGE-QUICKSTART.md) for installation and the
local `--consent-typing` behavior. Temporary access is not an anonymity, retention
or deletion guarantee.
