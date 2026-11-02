// Exercise baseline: intentionally unsafe. Fix against TASK.md and the contract.
export async function resolveConflict({base, readRemote, readLatestDraft}) {
  const draft = readLatestDraft();
  const remote = await readRemote();
  return {kind: 'retry', expectedRevision: remote.revision, patch: {...draft}, draft: {...draft}};
}
