# Fixed public contract

The import endpoint receives an array of customer records. Improve `importCustomers(rows, existingEmails)` so it processes every row independently and returns `{accepted, errors}`. A valid row has a non-empty trimmed name and an email matching `local@domain` with no spaces and at least one dot in the domain. Normalize names by trimming, and emails by trimming and lowercasing. Duplicate emails, including duplicates within the batch or in `existingEmails` (case-insensitive), are rejected. Each error has the original zero-based `index` and `reason` equal to `invalid_name`, `invalid_email`, or `duplicate_email`; report the first applicable reason in that order. Do not modify the input or existing set.

Run the project tests with `node --test`. These requirements are public; facilitator checks may cover additional examples of the same behavior.
