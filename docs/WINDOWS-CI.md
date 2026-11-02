# Bounded Windows qualification

The checked-in Windows workflow is a credential-free diagnostic, not a hosted judge service. Its bootstrap deliberately refuses a tree containing the designated judge-access bundle. Do not dispatch this credential-bearing submission tree to hosted CI.

For a separately reviewed credential-free copy, the explicit qualification job uses `A2_WINDOWS_QUALIFICATION=1` and `A2_QUALIFICATION_MODE=native` or `wsl`. It has a ten-minute limit and no automatic retry. The bootstrap verifies pinned tools and limits artifacts to allowlisted metadata; authentication files, native output and transcripts are excluded.

## What each mode checks

| Mode | Scope | Limit |
| --- | --- | --- |
| native | Official checksum-verified Muse Windows CLI, synthetic Echo response, and early native-harness refusal before credential loading | No native Windows harness support, user login, real model or OP qualification |
| wsl | WSL2 availability followed by a synthetic Linux CLI check when available | Installation or kernel failure means unavailable, not passed; no interactive sign-in or full judge journey |

Native Windows CLI Echo and the precredential harness guards have been checked. Hosted WSL2 installation was unavailable; no full WSL login/model/Presence journey is qualified. Source review and macOS tests do not establish either Windows route. No security bypass or transfer of a Mac's credentials is part of this workflow.

## Fresh judge-owned Muse connection

On a real interactive WSL2 host, follow [Microsoft's WSL instructions](https://learn.microsoft.com/en-us/windows/wsl/install) and [Meta's Muse instructions](https://dev.meta.ai/docs/muse-code). Use your own entitled account and keep the checkout, Node, Muse and authentication in Linux home.

```sh
node scripts/qualify-wsl-muse.mjs --login
node scripts/qualify-wsl-muse.mjs --preflight
# Explicitly consumes your own model usage:
node scripts/qualify-wsl-muse.mjs --check --allow-one-model-request
```

Login is interactive and refuses CI. Preflight reads authentication metadata only. The final command permits one synthetic Spark request with tools and contributor mode off, one model step, sixty seconds and no retry. A successful login does not establish model entitlement; the request is a separate check. Hosted CI cannot substitute for the judge's browser sign-in. See [platform support](PLATFORM-SUPPORT.md).
