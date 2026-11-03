# Temporary judge access

## Designated OP access and separate installation

The designated `judge-access/temporary-credentials.json` supplies temporary OP
evaluation access and is OP-only, without a Muse key or npm token. The coordinator
verified the user’s cleanup in `44be3b1` left the OP fields unchanged; Git history
was not purged. Normal installation does not read this file. Keep
its local copy mode 0600; the user's own Muse login and billing remain separate.
The separate private development-history checkout omits it. Use [the first-time journey](../docs/JUDGE-QUICKSTART.md)
for consent, fallback and setup.

The intended normal `npm run judge:install` uses anonymous locked npm access and
does not read this file, the old npm token or user/global npm credentials. The
public Cipher lite packages and a fresh empty-cache install were verified locally
on 3 November; your independent Muse login/coding journey remains separate. An explicitly supplied private access path is a legacy developer
option, not the normal judge route. No private Cipher package archive, generated
bundle or `node_modules` is committed.

Live startup reads the OP file only with `--consent-typing`; no-consent startup
does not read it. Confirmed shutdown/error paths remove copied configuration.
Catchable Ctrl-C, termination and terminal hangup follow the owned cleanup flow.
If installer process-group termination is unconfirmed, the installer withholds
cleanup and reports its originally allocated directory for checked recovery; its
normal public config contains no token. A legacy private path may retain a copied
npm credential. File cleanup failure has a distinct error and no verified recovery
target. See [installer recovery](../docs/JUDGE-QUICKSTART.md#installer-recovery).
A force-kill/crash cannot guarantee cleanup. Never put a Muse key in this file or
send credential contents in screenshots, feedback or evidence.

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

## Dated access facts

- The former public-judge npm token was revoked on 3 November 2026. Normal judge
  installation no longer uses or replaces it. Previously downloaded packages are
  not removed by revocation. Anonymous installation of the pinned lite packages passed locally on
  3 November; the original private package identities are unchanged.
- OP authentication previously accepted the configured account and issued a
  one-hour access token; that token lifetime does not establish the client secret's
  expiry. The owner reports a dated grant expiry of 15 November 2026 at 17:00 UTC;
  current service acceptance was not freshly verified. The launcher independently
  refuses this file from 00:00 UTC on that date and the server may reject earlier.
- Muse entitlement remains separate. Judges use their own authorized account or
  key and applicable plan or credits.

The owner reports that the 28–29 October Muse configuration uses one retained
calibration subject for Teresa and testers. Local session IDs do not isolate its
norms, and one participant's activity can affect later normalization. Teresa
accepts this shared demo configuration. The reported service records submitted
metadata and derived profiles. The owner says Area2/Open Presence interaction data
has no enforced fixed retention or routine automatic deletion. A request to remove
the whole shared Muse evaluation dataset and calibration contribution can be sent
to developers@area2.ai; execution, timing and log/backup coverage are untested and
not guaranteed. It does not cover unrelated Area2 datasets. See [Privacy & Data Use](../docs/PRIVACY-DATA-USE.md). Do not send simulated typing
to the shared live account as though it were real user input.

## Maintainer release/revocation checks

Verify the actual selected OP account, expiry, quotas, allowed actions and data
boundaries against service administration where available.
Keep the verification receipt private and omit values from the release checklist.
Replace overly broad access if needed. Inspect only the intended submission tree;
do not print the prepared secret file or rely on a general filename scan to clear it.

The former npm token is already revoked. The OP owner can disable/revoke the
designated client through its service administration.
Before revocation, check whether another runtime uses that same identity. This work
does not change live credentials, collectors or service administration. Future
release changes and submission remain separate owner decisions.

Read [Privacy & Data Use](../docs/PRIVACY-DATA-USE.md) before consenting to capture;
use [the judge quickstart](../docs/JUDGE-QUICKSTART.md) for installation and the
local `--consent-typing` behavior. Temporary access is not an anonymity, retention
or deletion guarantee.
