# Privacy & Data Use

Open Presence × Muse demo · 3 November 2026

Enabling textbox Presence lets this application send interaction metadata from
its message box to Area2/Open Presence to request collaboration guidance. Sending
a message separately sends your message and task context to Meta/Muse. The
optional **See Presence impact** action makes a separate Meta/Muse assessment.
Interaction metadata is **not anonymous**. Read the routes and open confirmations
below before enabling capture; avoid sensitive material in a test session.

## What goes where

| Route | Information and purpose |
| --- | --- |
| Message box → application backend → Area2/Open Presence | Key press/release timings, key-area/type categories, event count, a collection-session identifier, collection start time, timezone, season, time-of-day and weekday context. Used to return guidance about response depth, optional updates and conversation style. |
| Application backend → Area2 authentication service | Developer application credentials obtain a bearer token. The OP capture then carries that token. These are separate from the judge's Muse login. |
| Application → Meta/Muse coding sessions | Your messages, selected task/workspace context and tool results needed for the coding task. The With Presence arm additionally receives rendered Presence guidance; the Without arm does not receive that guidance. |
| Optional **See Presence impact** → Meta/Muse Spark 1.3 | Selected recorded exchanges, work-file excerpts, Presence evidence, self-reported effort/interruption measures and interaction/resource metrics for a separate assessment. It runs only when you request it. Selected text/code may contain private data or embedded credentials; filtering is not comprehensive. |
| Optional **Explain recorded facts with Muse**, where available → Meta/Muse Spark 1.3 | A bounded catalogue of derived Presence/session facts for a separate explanation. This is distinct from the comparison action's selected exchanges/work packet. |

The reviewed textbox binding passes key-event values locally to Cipher to produce
categories and timings. Its minimized OP request has no composer-text, prompt,
source-code or clipboard field; `appContext` and `emojis` are removed. This describes
the application's inspected request path, checked with synthetic transport tests.
It is not a live packet capture or a guarantee about every browser, SDK or network
component. The ordinary coding and optional Observer routes **do** send selected
text to Meta; the metadata-only OP route does not describe those other routes.

The OP client authenticates at `auth.area2-ai.com` and sends captures to
`api.area2-ai.com/v2/capture` (or `api-dev.area2-ai.com/v2/capture` in development).
These services can associate requests with the developer credential and observe
network/request information, including the backend's source IP. The payload
includes a session identifier and timestamps. This is not a promise of no
identification, unlinkability or absence of server logs. Metadata can reveal
interaction patterns or permit sensitive inference even without a text field.
Cipher installation uses separate npm registry access; that is not the typing-metadata flow.

## When capture starts and stops

For the local judge flow, first read this notice and then deliberately launch
`npm run judge:start -- --consent-typing` if you agree. This flag authorizes textbox
capture when sessions open; there is no additional local entry checkbox. Metadata
can be dispatched while you type, **before Send**. Windows follow focus/input and
Send, Enter or loss of focus, with intermediate samples and rate limits. Choosing
the Without recipient does not disable session-level capture. This flow does not
require the separate Mac background collector.

**Close sessions** or stop the local server with Ctrl-C to stop this session's
future capture. Interrupting a model turn is not withdrawal of typing consent.
For coding without textbox Presence, launch without `--consent-typing`; the judge
path then performs no OP authentication or capture. Stopping does not recall
already transmitted requests or delete saved local or upstream records. A request
already dispatched can still finish upstream despite local cancellation.
A separately hosted version needs its own entry notice/consent and access controls;
those are not supplied by the local launcher or this document.

## Saved records and upstream limits

Local storage means the machine running the application backend; in a hosted
version that would be the operator's server, not necessarily your device.
The application keeps work files and local comparison evidence, including policy,
usage and timing-window event summaries. Default evidence packages omit full
transcripts and raw key-timing arrays; assessment text can still describe private
task details. Optional quoted excerpts add selected response text. Export saves a
file; it does not itself publish it or run another model. Inspect before sharing.
No automatic deletion of work files or saved evidence is promised.

This client uses `user_mode: internal` with the shared developer credential.
The owner reports that the 28–29 October Muse configuration uses one retained
calibration subject shared by Teresa and testers. A local session ID does not
isolate its norms: one participant's activity can influence later normalization.
The owner accepts this configuration for the demo. Current service acceptance
and configuration have not been freshly verified.

The owner reports that the default service path records submitted event metadata
before inference and records derived profiles; Analytics retains calibration/
cumulative state and summaries. The service can include eligible profiles in population
aggregation, but whether these records are included is unverified. The inspected
no-text field list above applies to this client, not a universal server allowlist.

The infrastructure owner reported on 3 November that the two checked default
Firestore databases are in nam5 (US Central), with no Muse calibration TTL found.
No scheduled or Admin Firestore backups were listed for the checked databases;
this does not cover RTDB, exports, workstation copies or other backups. The checked
default log buckets retain logs for 30 days and required audit buckets for 400 days.
Log contents, access and residency were not verified; these periods do not establish
that every log contains tester data or that other copies are deleted on that schedule.
RTDB location/backups, the access/deletion process, secondary use or training,
the responsible entity, approved policy and privacy contact remain unconfirmed. Local clearing,
access expiry or credential rotation is not upstream deletion. Meta's applicable
account/service terms govern its own handling; contributor mode off is not a
verified retention/deletion guarantee.
