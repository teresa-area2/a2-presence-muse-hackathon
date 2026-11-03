# Dependencies and distribution

The repository includes the selected Agent Lab/Pulse closure and Capsule validator, with their manifests and notices. Cipher is an external npm dependency; Muse Code and Open Presence inference remain external services. See [provenance](PROVENANCE.md) for reused-work and agent attribution.

## Agent Lab and Pulse

The selected source snapshot is pinned to `ba8bf79073aae931e55fe6d1deb20f71d6a02b49` in `components.json`. Its selected files, integrity hashes, license and notices are recorded in `vendor/agent-lab/manifest.json`, `vendor/agent-lab/LICENSE`, `vendor/agent-lab/NOTICE`, and the host-adapter notices. On 31 October 2026 Area2 authorized Apache-2.0 redistribution for the selected Lab/Pulse files; this grant does not extend to entire upstream repositories. These files are actual reused code. The NOTICE distinguishes pre-kickoff 24–25 October foundations from later 28 October hook/fallback refinements; do not label the entire selected snapshot as pre-event or as newly authored Muse integration. The earlier Area2 comparison demo separately informed the visual presentation.

## Capsule validator

The vendored validator's upstream artifact SHA-256 is `7d03442ea27814f987f2111022c5a517dcb3d8bb68f89620c91c50c4420a811b`. It came from a dirty upstream checkout based at `12c6b50`; the base commit by itself does not establish the artifact's build or date. Exact retained inputs, output hashes, license and notices are in `vendor/capsule-validator/manifest.json`, `build.json` and `NOTICE.md`. Area2's 31 October 2026 authorization covers this selected validator snapshot, preserving third-party MIT/BSD notices. Its included AJV dependency archives are third-party build inputs, not Cipher packages. Run `npm run check:dependencies` to verify the included manifests.

## Cipher and external services

The locked anonymous npm install resolves the existing React/core import names to public `@area2-ai/a2-cipher-react-lite@3.0.0` and `@area2-ai/a2-cipher-core-lite@2.1.0`. The original private packages are separate identities. A fresh empty-cache install, normal judge install/build and 1,755 offline checks passed locally on 3 November. Their implementations, cached packages, `node_modules` and generated browser bundle are not included in the repository. The integration files and lockfile under `integrations/cipher-textbox/` are required to build the local browser client. OP inference and Muse Code are separately operated; the repository does not redistribute a Muse binary or provide a Muse account.

The designated `judge-access/temporary-credentials.json` supplies OP evaluation access, not a Muse key. An obsolete revoked npm entry remains pending owner cleanup and is never read by normal installation. The former public-judge npm token was revoked on 3 November 2026. The OP service uses the owner-reported shared calibration subject; quota and upstream deletion remain unverified. Read [access scope and expiry](../judge-access/README.md) before use or distribution.
