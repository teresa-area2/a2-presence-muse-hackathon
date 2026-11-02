# Public contract: shared trip expenses

## API and inputs

`src/settle.mjs` exports exactly one function, `settleTrip({people, expenses})`. It is synchronous and returns a new object with `balances` and `transfers`. It performs no I/O and never changes any input object or array, including nested `sharedBy` arrays.

- `people` contains 1–20 unique person IDs. An ID matches `/^[a-z][a-z0-9-]{0,31}$/` (for example `alice`, `ben` or `cara`). IDs are identifiers, not display names.
- `expenses` contains 0–200 plain objects. Each has `paidBy` (one of the people) and `amountCents` (an integer from 1 through 1,000,000,000). Additional metadata is ignored.
- An expense may have `sharedBy`, a nonempty array of unique known person IDs. When this property is absent, everyone shares that expense. A payer need not belong to that expense's sharing group.
- Invalid top-level input, missing required fields, invalid IDs, duplicates, unknown people, empty sharing groups, non-integer/out-of-range amounts or invalid collection types throw `TypeError`. Exact error messages are not part of the contract. A plain object means its prototype is `Object.prototype` or `null`; arrays, dates and class instances are not expense objects. No prototype/security guarantee beyond this fixed validation is claimed.

## Cents and balances

For each expense, split `amountCents` equally among its sharing group using integer cents. Sort that group's IDs in ascending ASCII order. Give one extra cent to each of the first IDs until any remainder is exhausted. Input array order must not change the result. Never round to floating-point currency amounts.

For each person, `balanceCents = total paid - total owed`. A positive balance means they should receive money; a negative balance means they should pay. Include everyone, including zero balances, in `balances`, sorted by person ID:

```js
[{person: 'alice', balanceCents: 6000}, ...]
```

The stated input bounds keep totals at or below 200,000,000,000 cents, within JavaScript's safe integer range.

## Deterministic transfers

Make `transfers` by separately sorting debtors and creditors by person ID. Starting with the first of each, transfer the smaller of the debtor's remaining debt and the creditor's remaining credit, then advance each exhausted side. Each row is `{from, to, amountCents}` with a positive integer amount. Do not emit zero transfers or self-transfers. If all balances are zero, return `transfers: []`. This defines a repeatable settlement, not a globally minimum-transfer optimization.

## Worked example

```js
settleTrip({
  people: ['cara', 'alice', 'ben'],
  expenses: [
    {paidBy: 'alice', amountCents: 9000},
    {paidBy: 'ben', amountCents: 3000, sharedBy: ['cara', 'ben']}
  ]
})
// {
//   balances: [
//     {person: 'alice', balanceCents: 6000},
//     {person: 'ben', balanceCents: -1500},
//     {person: 'cara', balanceCents: -4500}
//   ],
//   transfers: [
//     {from: 'ben', to: 'alice', amountCents: 1500},
//     {from: 'cara', to: 'alice', amountCents: 4500}
//   ]
// }
```

Five cents shared by `cara`, `alice` and `ben` means Alice owes 2 cents, Ben 2 and Cara 1, regardless of their input order.

Run public tests with `node --test`. Facilitator checks cover further examples of this same public contract. Changing the rounding rule, adding exchange rates, percentages or a UI is a separately agreed extension, not part of this task's scored acceptance.
