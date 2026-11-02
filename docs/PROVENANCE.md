# Source and dependency provenance

The event-period work in this repository is the Muse-specific interactive
experience and UI adaptation, plus the current Presence/coding/evidence integration
around reused components. An earlier Area2 Open Presence side-by-side comparison
demo informed the visual design; it is a visual reference, not a claim that the
underlying foundations were created from scratch during the event. The private
event build records and source-transfer manifests support this boundary but are
not included in the public candidate or its Git history. They are not independent
proof of the creation date or authorship of every line.

The selected Agent Lab/Pulse files are actually imported byte-for-byte from the
pinned snapshot, rather than merely inspired by it. Its [NOTICE](../vendor/agent-lab/NOTICE)
records pre-kickoff 24–25 October extraction/session foundations and later 28 October
hook/fallback refinements. The vendored snapshot therefore has mixed timing;
reuse here does not mean every upstream byte predates the event. Snapshot import,
assembly and integrity checks in this repository are separate integration work.
See [dependencies](DEPENDENCIES.md), components.json and the vendor manifests.

The Capsule validator is also an actual reused snapshot. Its retained artifact
came from a dirty upstream checkout based at `12c6b50`; that commit alone does not
reproduce it or establish its build date. Original artifact and source/schema
hashes remain distinct in its manifest/build records. The scoped
[validator notice](../vendor/capsule-validator/NOTICE.md) and third-party notices
are retained. No inference/model work is claimed for importing this validator.

Area2's 31 October authorization permits Apache-2.0 distribution of the selected
Lab/Pulse and validator files, preserving existing MIT/BSD/Apache notices. It does
not relicense whole upstream repositories or grant service/model admission. The
repository's contributed integration uses the root Apache-2.0 license. No
proprietary Diatype font is included.

Cipher React/core implementations are private scoped packages on the public npm
registry. They are installed with authorized access rather than shipped as code,
archives or a compiled browser bundle. Open Presence
inference and Muse Code/model access remain external. The event integration was
developed using Muse Code and additional development/review tools. Component
disclosure and owner licensing do not settle hackathon eligibility; no new
organizer ruling is claimed. [Qualification status](STATUS.md) remains separate
from evidence interpretation and the owner's final submission decisions.
