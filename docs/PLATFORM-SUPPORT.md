# Judge platform support

The preferred rehearsal machine is an Apple Silicon Mac. An Intel Mac has not had this project's complete judge journey qualified.

Implemented paths and checked mechanisms are different from a complete judge journey. Every route uses the judge's own entitled Muse account. The temporary OP/Cipher bundle provides no Muse access; the background Mac collector is not required.

| Route | Checked behavior | Still open |
| --- | --- | --- |
| macOS arm64, Node22, Muse1.4.13/1.4.14 | Dependency build/setup, existing-account model use and native control mechanisms | Independent fresh login and complete coding/approval/real OP/export journey; full 1.4.14 coding qualification |
| Linux arm64 | Dependency build/setup and native Echo startup, steering, interruption, continuation and cleanup | Fresh registry access, real account/model/OP journey and Linux x86 qualification |
| Linux Check code | Missing or denied Bubblewrap isolation returns unavailable, without host execution fallback | Positive sandbox execution and independent descendant-cleanup qualification |
| Windows via WSL2 | Availability diagnostic implemented; hosted WSL2 installation unavailable | WSL2 kernel, localhost forwarding, own login/model access and full judge journey |
| Native Windows | Official Muse CLI Echo and early harness refusal before credential loading | Native harness remains unsupported |

Echo is a synthetic native-provider check; it establishes no Meta model behavior, OP reading or human benefit. See [qualification status](STATUS.md).

## Local-machine trust

These routes assume a trusted personal machine/session. Loopback and browser
Origin checks do not authenticate local OS users/processes; an allowed local
caller can obtain the bootstrap token. This is not a multi-user-host or remote
gateway boundary. See [local trust](JUDGE-QUICKSTART.md#local-trust-boundary).

## Optional Linux code verification

Install the distribution's maintained Bubblewrap package and run:

```sh
npm run check:linux-sandbox
```

`/usr/bin/bwrap` needs usable unprivileged user, network, PID, IPC and mount namespaces. The trusted probe verifies isolation, read-only source and writable private scratch before candidate tests run. Host home, credentials and service sockets are not mounted. A missing or denied sandbox returns unavailable; it never falls back to running generated code directly on the host. Do not disable host protections or add privileges to turn an unavailable result into a pass.

Interactive Muse sessions may still work when independent Check code is unavailable. That does not qualify code-check results or repair feedback. Descendant cleanup and positive isolation remain separate checks.

The independent Check code verifier and Muse's native coding-tool sandbox are
separate profiles. Verifier scratch-home/network checks do not qualify every
native coding-tool boundary. No harmless outside-worktree/credential-canary or
loopback reachability check has established the complete native tool boundary
here; HOME/auth references alone prove neither a leak nor isolation. Preserve
normal native approvals and the trusted-machine assumption during that rehearsal.

## Reproducing the checks

Use `npm run test:offline` after dependency installation. Offline fixtures do not establish fresh login, real-person typing, billing, model quality or a complete platform journey.

## Windows setup

Follow the [Linux/WSL2 quickstart](JUDGE-QUICKSTART.md#linux-and-windows-through-wsl2). Keep the checkout and credentials in Linux home and use Linux Node/npm/Muse. Do not mix Windows credentials or binaries into that process tree. Removing the native Windows guard would not supply the missing process ownership, private-file, IPC and path guarantees.

Primary references: [Meta Muse Code](https://dev.meta.ai/docs/muse-code), [Bubblewrap](https://github.com/containers/bubblewrap/blob/main/bwrap.xml), [Microsoft WSL files](https://learn.microsoft.com/en-us/windows/wsl/filesystems) and [WSL networking](https://learn.microsoft.com/en-us/windows/wsl/networking).

## Actual hosted Windows CI

Native CLI Echo and precredential guards have been exercised; WSL2 was unavailable. The submission tree contains the designated temporary access and must not be dispatched to the credential-free Windows bootstrap. See [CI scope](WINDOWS-CI.md); none of those diagnostics qualifies a full judge-owned login and coding experience.

Teresa has no Windows computer available for a physical rehearsal. Hosted Windows Echo checks do not qualify the harness, and unavailable hosted WSL2 installation is not a pass. Do not describe native Windows or a complete WSL login/model/OP journey as tested.
