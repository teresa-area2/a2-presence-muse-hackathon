# Fixed public contract

The notification selector is becoming hard to maintain. Refactor `selectChannels(event, preferences)` into clear policy checks and add quiet-hours handling. Return an array in the original `preferences.channels` order, without duplicates. A channel is selected only if enabled in `preferences.enabled` and, for a non-urgent event, not blocked by quiet hours. Quiet hours are the half-open local minute interval `[start, end)`; if start is greater than end the interval wraps over midnight, and equal start/end means no quiet hours. Urgent events bypass quiet hours but not disabled channels. `event.minute` is an integer from 0 to 1439. No mutation of either argument.

Run the project tests with `node --test`. These requirements are public; facilitator checks may cover additional examples of the same behavior.
