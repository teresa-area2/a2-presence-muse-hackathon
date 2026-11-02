// Placeholder: the group is listed, but expenses are not settled yet.
export function settleTrip({people}) {
  return {
    balances: people.slice().sort().map(person => ({person, balanceCents: 0})),
    transfers: []
  };
}
