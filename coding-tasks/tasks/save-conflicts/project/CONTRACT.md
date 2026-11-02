# Fixed public contract

A task-board saves an edit using a revision number. Fix the save flow so a conflict does not lose the latest unsaved edit. On a conflict, fetch the current server record, merge the pending edited fields over it, and retry at most once using the fetched revision. Leave the caller’s draft unchanged. If the retry fails, return the failure without further writes. Successful saves return the saved record. The server client exposes `save(id, patch, expectedRevision)` and `get(id)`; a conflict rejects with `code: 'CONFLICT'`.

Run the project tests with `node --test`. These requirements are public; facilitator checks may cover additional examples of the same behavior.
