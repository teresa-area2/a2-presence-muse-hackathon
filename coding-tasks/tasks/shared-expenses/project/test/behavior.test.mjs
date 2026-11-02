import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

// Resolve the project root from TASK_PROJECT_DIR when the tester provides
// it, otherwise relative to this test file (project/test/ -> project/).
const projectBase = process.env.TASK_PROJECT_DIR
  ? pathToFileURL(
      process.env.TASK_PROJECT_DIR.endsWith("/")
        ? process.env.TASK_PROJECT_DIR
        : `${process.env.TASK_PROJECT_DIR}/`,
    )
  : new URL("../", import.meta.url);

const { settleTrip } = await import(new URL("src/settle.mjs", projectBase));

test("ana pays a 1000-cent dinner shared by everyone", () => {
  const result = settleTrip({
    people: ["bea", "ana", "cam"],
    expenses: [{ paidBy: "ana", amountCents: 1000 }],
  });

  // 1000 split three ways is 334/333/333: sorted sharers are ana, bea, cam,
  // so ana (who also paid) owes the extra cent and ends up 1000 - 334 = 666.
  assert.deepEqual(result, {
    balances: [
      { person: "ana", balanceCents: 666 },
      { person: "bea", balanceCents: -333 },
      { person: "cam", balanceCents: -333 },
    ],
    transfers: [
      { from: "bea", to: "ana", amountCents: 333 },
      { from: "cam", to: "ana", amountCents: 333 },
    ],
  });
});

test("cam pays a 101-cent taxi shared only by ana and bea", () => {
  const result = settleTrip({
    people: ["ana", "bea", "cam"],
    expenses: [{ paidBy: "cam", amountCents: 101, sharedBy: ["bea", "ana"] }],
  });

  // 101 split between ana and bea (sorted order) is 51/50, so ana owes the
  // extra cent. Cam paid but did not share, so cam is owed the full 101.
  assert.deepEqual(result, {
    balances: [
      { person: "ana", balanceCents: -51 },
      { person: "bea", balanceCents: -50 },
      { person: "cam", balanceCents: 101 },
    ],
    transfers: [
      { from: "ana", to: "cam", amountCents: 51 },
      { from: "bea", to: "cam", amountCents: 50 },
    ],
  });
});
