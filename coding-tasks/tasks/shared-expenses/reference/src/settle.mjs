// Shared-trip bill settlement.
//
// Each expense is split as evenly as possible (in whole cents) among its
// sharers. People are handled in ascending ID order everywhere, and any
// leftover cents from a split go one each to the first sharers in that order.
// A person's balance is what they paid minus what they owed, so positive
// balances are owed money back and negative balances owe money.

const ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_PEOPLE = 20;
const MAX_EXPENSES = 200;
const MAX_AMOUNT_CENTS = 1_000_000_000;

function fail(message) {
  throw new TypeError(message);
}

function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// ASCII lexical order for the restricted ID alphabet. This is an explicit
// code-unit comparison, not locale-aware ordering.
function compareIds(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function validatePeople(people) {
  if (!Array.isArray(people)) {
    fail("people must be an array");
  }
  if (people.length < 1 || people.length > MAX_PEOPLE) {
    fail("people must contain between 1 and 20 entries");
  }
  const seen = new Set();
  for (const person of people) {
    if (typeof person !== "string" || !ID_PATTERN.test(person)) {
      fail("each person must be a valid ID string");
    }
    if (seen.has(person)) {
      fail("people must not contain duplicates");
    }
    seen.add(person);
  }
  return seen;
}

function validateSharedBy(sharedBy, knownPeople) {
  if (!Array.isArray(sharedBy)) {
    fail("sharedBy must be an array");
  }
  if (sharedBy.length === 0) {
    fail("sharedBy must not be empty");
  }
  const seen = new Set();
  for (const person of sharedBy) {
    if (typeof person !== "string" || !knownPeople.has(person)) {
      fail("sharedBy must contain only known people");
    }
    if (seen.has(person)) {
      fail("sharedBy must not contain duplicates");
    }
    seen.add(person);
  }
  // Copy before sorting so a (possibly frozen) input array is never mutated.
  return [...sharedBy].sort(compareIds);
}

export function settleTrip(input) {
  if (!isPlainRecord(input)) {
    fail("input must be a plain record");
  }
  const { people, expenses } = input;
  const knownPeople = validatePeople(people);
  if (!Array.isArray(expenses)) {
    fail("expenses must be an array");
  }
  if (expenses.length > MAX_EXPENSES) {
    fail("expenses must contain at most 200 entries");
  }

  const sortedPeople = [...people].sort(compareIds);
  const everyoneSorted = sortedPeople; // already a private copy
  const balanceByPerson = new Map(sortedPeople.map((person) => [person, 0]));

  for (const expense of expenses) {
    if (!isPlainRecord(expense)) {
      fail("each expense must be a plain record");
    }
    const { paidBy, amountCents } = expense;
    if (typeof paidBy !== "string" || !knownPeople.has(paidBy)) {
      fail("paidBy must be a known person");
    }
    if (
      typeof amountCents !== "number" ||
      !Number.isInteger(amountCents) ||
      amountCents <= 0 ||
      amountCents > MAX_AMOUNT_CENTS
    ) {
      fail("amountCents must be a positive integer up to 1000000000");
    }

    const sharers =
      expense.sharedBy === undefined && !("sharedBy" in expense)
        ? everyoneSorted
        : validateSharedBy(expense.sharedBy, knownPeople);
    // Note: an explicitly present sharedBy must be a valid array; only a
    // genuinely omitted one defaults to everyone. The branch above treats
    // a present-but-undefined sharedBy as provided, so it is rejected by
    // validateSharedBy. Extra expense metadata is simply ignored.

    balanceByPerson.set(paidBy, balanceByPerson.get(paidBy) + amountCents);

    const count = sharers.length;
    const baseShare = Math.floor(amountCents / count);
    const remainder = amountCents % count;
    sharers.forEach((person, index) => {
      const owed = baseShare + (index < remainder ? 1 : 0);
      balanceByPerson.set(person, balanceByPerson.get(person) - owed);
    });
  }

  const balances = sortedPeople.map((person) => {
    const balanceCents = balanceByPerson.get(person);
    return { person, balanceCents: balanceCents === 0 ? 0 : balanceCents };
  });

  // Greedy settlement: walk debtors and creditors, both in ascending ID
  // order, transferring the smaller outstanding amount each step and
  // advancing whichever side is exhausted (both if they match exactly).
  const debtors = balances
    .filter(({ balanceCents }) => balanceCents < 0)
    .map(({ person, balanceCents }) => ({ person, remaining: -balanceCents }));
  const creditors = balances
    .filter(({ balanceCents }) => balanceCents > 0)
    .map(({ person, balanceCents }) => ({ person, remaining: balanceCents }));

  const transfers = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountCents = Math.min(debtor.remaining, creditor.remaining);
    if (amountCents > 0) {
      transfers.push({ from: debtor.person, to: creditor.person, amountCents });
    }
    debtor.remaining -= amountCents;
    creditor.remaining -= amountCents;
    if (debtor.remaining === 0) debtorIndex += 1;
    if (creditor.remaining === 0) creditorIndex += 1;
  }

  return { balances, transfers };
}
