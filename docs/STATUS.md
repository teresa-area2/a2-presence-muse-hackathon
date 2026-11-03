# Qualification status

This candidate records checked behavior and remaining limits. It does not claim a
complete independent judge journey or production qualification.

- **Offline/source checks:** combined recovery source `d3e5b79` with Mauro's
  public lite package PR94a466b passed all 1,755 offline checks, zero failures/skips,
  on Node22.12.0 in a fresh local checkout. Five task fixtures and offline textbox
  replay passed. Separate compatibility review passed35 focused synthetic tests,
  plus an in-memory embedded/direct-core probe; no real React browser/typing or
  independent judge journey is established by those checks.
- **Cipher installation:** public `@area2-ai/a2-cipher-react-lite@3.0.0` and
  `@area2-ai/a2-cipher-core-lite@2.1.0` installed from an empty npm cache with
  isolated registry-only user/empty global configs and no token/config inheritance.
  The normal `npm run judge:install` then passed install/build/setup/pin checks.
  Existing import paths are npm aliases; original private packages remain separate.
  The former npm token is revoked; normal judge installation never reads it or the
  OP access file. This is a local installation qualification, not live OP admission.
- **Credential-file cleanup:** the functional source PR deliberately leaves the
  actual evaluation file unchanged from public main. Its obsolete revoked npm
  entry is ignored by normal installation; owner cleanup remains separate. No new
  credential values or access are added by the source PR. OP-only examples and
  startup compatibility are supported, but this does not claim the current file
  has already been cleaned or that OP admission was rechecked.
- **Native Muse:** existing-account 1.4.13 empty sessions, hook installation and
  catchable judge hangup cleanup were exercised without a model turn or OP capture.
  Historical 1.4.14 protocol/control checks do not qualify its full current coding/
  Presence journey. Fresh own-account login, real typing/coding/approval and reopened
  export remain independent human-rehearsal gates. See [platform support](PLATFORM-SUPPORT.md).
- **OP cutoff:** synthetic clocks/fetchers cover new Auth/capture refusal, late
  response exclusion and retained-policy fallback at the configured judge cutoff.
  Coding sessions continue. This relies on the machine clock; the owner's dated
  server expiry report is not a fresh service check. Quotas remain unverified;
  the demo deliberately shares retained calibration across testers. Existing nonjudge configs
  without cutoff preserve their lifecycle. See [access handling](../judge-access/README.md).
- **Comparison scope:** both arms disable foreign personal imports while retaining
  task-local rules/skills and normal tools/approvals. Without Presence is the
  configured baseline, not the user's whole everyday Muse setup. Configuration-
  preserving everyday integration is a recommendation, not an implemented mode.
  Historical evidence retains its original source/configuration identity.
- **Resources/benefit:** cumulative native usage and observed provider responses
  have different scopes. Output can include reasoning and tool arguments. Figures
  do not establish billing totals, causal savings or human benefit; cost and full
  overhead can be unavailable.
- **Optional Observer:** only the explicit action sends selected evidence to Muse.
  Embedded secrets/private information can remain despite filename filtering;
  review the [disclosure](OBSERVER-REPORT.md). Both protocols explicitly request zero
  provider retries and reject reported usage over one call while retaining usage.
  No actual retry was observed; no automatic assessment is implied.
- **Cleanup:** catchable INT/TERM/HUP use owned async cleanup. Uncertain installer
  termination retains configuration for checked recovery; file-cleanup failure has
  a distinct error. Original paths are not verified deletion targets. Force-kill/
  crashes cannot guarantee cleanup. See [recovery](JUDGE-QUICKSTART.md#installer-recovery).
- **Local trust:** loopback/Origin checks do not authenticate OS users/processes;
  local callers can obtain the bootstrap token. Use a trusted personal machine;
  no multi-user-host or remote gateway boundary is claimed. Native Windows is
  refused; WSL/Linux qualification remains as documented. See [local trust](JUDGE-QUICKSTART.md#local-trust-boundary).
- **Exports and rights:** evidence export has deterministic coverage, but does not
  restore native conversations. No real-run evidence is included in this candidate.
  [Provenance/notices](PROVENANCE.md) document reuse without a new eligibility or
  independent rights ruling. Owner evidence/release choices remain separate.
