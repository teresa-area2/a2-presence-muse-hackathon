# Setup

Start with the [judge quickstart](JUDGE-QUICKSTART.md) for prerequisites, your own Muse authentication and explicit typing-metadata consent. The designated temporary OP-only file is the sole submission credential exception; see [its scope and expiry](../judge-access/README.md). It does not provide a Muse key or npm token.

## Dependencies and offline checks

Use Git and Node 22.12 or later within Node 22. After installing the official Muse Code CLI and configuring your own entitled, file-backed Muse authentication, run:

```sh
npm run judge:install
npm run check:setup
npm run test:offline
npm run test:tasks
```

The intended judge installer performs a locked anonymous Cipher npm install, builds the browser client and checks setup without reading an access file. It uses temporary owner-only registry-only user and empty global npm configuration, removes it before build/check, and refuses project `.npmrc` files. Proxy variables are not forwarded. Public availability of the locked versions and a clean install are pending verification; a registry failure is a setup failure, not permission to copy old packages. The generated `.local/web/cipher-textbox.mjs` and downloaded packages are not committed.

Offline checks use synthetic data and fake service adapters; some use temporary loopback sockets or the local sandbox. They do not establish model behavior, real-person benefit or first-time judge sign-in. See [qualification status](STATUS.md).

## Bundled code and optional local overrides

The normal textbox workspace uses checked snapshots under `vendor/agent-lab` and `vendor/capsule-validator`, with their manifests and notices. It does not require a separate Lab checkout or desktop Presence runtime. Muse Code and the OP service are external. `npm run check:dependencies` verifies the included dependency manifests and pins. `npm run build:validator` rebuilds the retained validator using its checked inputs and pinned build tool; a changed input requires a reviewed new import and pin. See [dependencies](DEPENDENCIES.md) and [provenance](PROVENANCE.md).

## OP live configuration (separate from offline setup)

Read [Privacy & Data Use](PRIVACY-DATA-USE.md) before authorizing capture.
For local judge consent, use the [explicit launcher steps](JUDGE-QUICKSTART.md#3-start-with-explicit-typing-consent).
A live-authorized session can send textbox metadata before Send; recipient selection
is not a capture-consent control. This does not authorize the optional model assessments.

The judge launcher enables live textbox Presence only with `--consent-typing`. The textbox collects interaction timing metadata for Presence; it does not require the separate Mac background collector. Start without that flag to use ordinary fallback. Live service availability, tenant boundaries and real-user qualification are not established by installation. Keep Muse credentials separate from the designated OP-only bundle.

## Automatic capture-event evidence

Compatible clients save bounded, client-reported capture lifecycle metadata locally. An unacknowledged close or crash tail can be lost; these records are not a reconstruction of missing typing or proof of benefit. Raw typing and Capsules are not intended as evidence exports.

## Request-level Presence evidence

Eligible guidance is read at supported model-request boundaries in the Presence arm. The baseline remains isolated. Saved attribution distinguishes observed guidance and fallback from unverified linkage; it does not prove the model followed a suggestion. Guidance can accumulate within a turn, and a native hook failure is a separate limitation. Never infer a person’s numerical state from the policy.

## Native approval review

The native approval view supports reviewed shell, file, network, socket, process and tool subjects, as well as a complete escaped view for supported generic requests. It presents native choices with their actual scopes; no choice is automatic. Protected writes and sensitive computer-use requests retain their restricted choices. Unknown, contradictory, incomplete or oversized requests remain non-actionable. Child approval display does not qualify native child execution.

A decision binds the currently displayed request and requirement. An acknowledgement is not final resolution. A matching resolved stage can temporarily display **Confirming decision** without additional actions while the native outcome is pending. Do not retry an uncertain decision automatically. Other approvals in the same pane may wait for the pending decision; the other pane remains independent.

Field and full-view size limits apply; content is not silently truncated into an actionable approval. Some inputs may remain unsupported. Offline approval tests and the local synthetic native fixture do not establish a full real-model approval journey. See [status](STATUS.md).

## Combined evidence package

The private output store revalidates current `.gitignore` protection when publishing. Safe ignore-file edits and atomic replacement are allowed; effective re-inclusion, replaced metadata and unsafe output paths are refused. A changed-output message preserves the comparison; a possibly saved file has a separate durability warning. The separate [review-copy command](../evidence/README.md) writes redacted copies under `evidence/runs/` without committing or publishing.

**Export evidence package** saves a versioned JSON snapshot to the checkout's ignored `.local/evidence-packages/` directory without starting a model or OP call. Its run/generation and source information identify the saved snapshot. The result may include assessment narrative containing private task data; selected excerpts are optional. Review it before sharing. Redaction is not a guarantee of anonymity, and saving evidence does not make an ended native conversation resumable.

For staged launchers, `A2_MUSE_EVIDENCE_REPOSITORY_ROOT` or the trusted launcher option must identify the actual Git checkout with the required `.local/` ignore rule. The browser cannot select a filesystem path. If the destination is unavailable, export is disabled rather than falling back to a staged runtime directory.

### Typed recorded observer facts

When present, recorded interaction counts are separate from model-authored assessment text. Unknown values remain unknown; counts and user-reported effort do not establish causation or a personal-state diagnosis.

## Presence tracker and Muse observer

The optional observer has separate usage from the coding sessions. Model actions occur only on explicit user request. The assessment input can contain selected exchanges and work files, including private task information or embedded credentials; filename filtering does not detect every secret. See the full [observer disclosure](OBSERVER-REPORT.md). Set `A2_MUSE_OBSERVER_ENABLED=0` to disable its model actions.

## Muse development model

The workspace offers Spark 1.3 and Wonder 1.0 for both agents. Select the same model before opening a pair. Muse entitlement, billing and model availability belong to the user's own account; a local setup does not establish them. See the [quickstart](JUDGE-QUICKSTART.md) for the file-backed authentication limitation.

## Comparison models and task battery

The five [coding tasks](../coding-tasks/README.md) use committed task, contract and acceptance-check bytes from the current checkout. Each arm receives a separate project workspace; reference solutions and frozen acceptance checks remain outside the agent-facing worktree. For **Your own task**, each workspace starts clean and has no frozen acceptance suite. A fresh Git checkout with its task files committed is required.

## Steering and interruption in the supported-session UI

Send a follow-up to one agent or Both to steer ongoing work. Escape interrupts selected active work; Ctrl+C clears a nonempty composer draft first, otherwise it can interrupt. A focused pane targets that pane; the shared composer targets its selected recipients. An in-flight provider call may finish before a steer takes effect. Close sessions ends both native sessions; saving evidence does not restore them after restart.

## Linux and Windows judge setup

See the [Linux/WSL2 quickstart](JUDGE-QUICKSTART.md#linux-and-windows-through-wsl2) and [platform status](PLATFORM-SUPPORT.md). Native Windows is refused before credential loading. The Linux code-check backend requires `/usr/bin/bwrap` and working isolated namespaces; `npm run check:linux-sandbox` reports availability using synthetic code. Unavailable isolation is not a pass and there is no unsandboxed fallback.
