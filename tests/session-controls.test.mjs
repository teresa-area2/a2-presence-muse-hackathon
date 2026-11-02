import test from 'node:test';
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  approvalFingerprint,
  canDecideCurrent,
  canSubmitTarget,
  selectedArms,
  nextRecipientTarget,
  sessionSubmitKey,
  draftAfterSend,
} from "../web/session-controls.mjs";

test('Command/Ctrl-click adds recipients; clicking both always keeps the composer on Both', () => {
  assert.equal(nextRecipientTarget('without', 'with', {metaKey: true}), 'both');
  assert.equal(nextRecipientTarget('with', 'without', {metaKey: true}), 'both');
  assert.equal(nextRecipientTarget('without', 'with', {ctrlKey: true}), 'both');
  assert.equal(nextRecipientTarget('both', 'with', {metaKey: true}), 'both');
  assert.equal(nextRecipientTarget('both', 'without', {ctrlKey: true}), 'both');
  assert.equal(nextRecipientTarget('with', 'with', {metaKey: true}), 'with');
  assert.equal(nextRecipientTarget('both', 'without'), 'without');
  assert.equal(nextRecipientTarget('without', 'both', {metaKey: true}), 'both');
  assert.equal(nextRecipientTarget('with', 'invalid', {metaKey: true}), 'with');
  for (const initial of ['without', 'with', 'both']) {
    for (const modifier of [{metaKey: true}, {ctrlKey: true}]) {
      const first = nextRecipientTarget(initial, 'without', modifier);
      assert.equal(nextRecipientTarget(first, 'with', modifier), 'both');
      const reversed = nextRecipientTarget(initial, 'with', modifier);
      assert.equal(nextRecipientTarget(reversed, 'without', modifier), 'both');
    }
  }
});

test('only unmodified Enter submits, without repeat or IME completion',()=>{
  assert.equal(sessionSubmitKey({key:'Enter'}),true);
  for(const field of ['shiftKey','altKey','ctrlKey','metaKey','repeat','isComposing'])assert.equal(sessionSubmitKey({key:'Enter',[field]:true}),false,field);
  assert.equal(sessionSubmitKey({key:'Enter',keyCode:229}),false);
  assert.equal(sessionSubmitKey({key:'a'}),false);
});
test('acknowledged send clears only the exact unchanged submitted draft',()=>{
  const base={current:'task',submitted:'task',revision:2,submittedRevision:2,acknowledged:true,generation:1,submittedGeneration:1};
  assert.equal(draftAfterSend(base),'');
  assert.equal(draftAfterSend({...base,acknowledged:false}),'task');
  assert.equal(draftAfterSend({...base,generation:2}),'task','old-session acknowledgment must not erase new-session text');
  assert.equal(draftAfterSend({...base,current:'next task',revision:3}),'next task');
  assert.equal(draftAfterSend({...base,revision:4}),'task','retyping the same text is a new draft');
});

function makeApproval(overrides = {}) {
  const {sourceIndex=0,...rest}=overrides;
  return {
    status: "review",
    review_token: "a".repeat(64),
    approvalId: "appr-1",
    requirementId: { approvalId: "appr-1", sourceIndex },
    command: "ls -la",
    choices: [
      { choiceId: "yes", label: "Approve",decision:"approved",scope:"once" },
      { choiceId: "no", label: "Reject",decision:"denied",scope:"once" },
    ],
    ...rest,
  };
}

function makeState(overrides = {}) {
  return {
    status: "ready",
    arms: {
      without: { status: "ready", approvals: [] },
      with: { status: "ready", approvals: [] },
      ...overrides.arms,
    },
    ...overrides,
  };
}

function submitBase(overrides = {}) {
  return {
    state: makeState(),
    target: "without",
    text: "hello",
    connected: true,
    pending: false,
    uncertain: false,
    ...overrides,
  };
}

describe("selectedArms", () => {
  it("maps without/with/both", () => {
    assert.deepEqual(selectedArms("without"), ["without"]);
    assert.deepEqual(selectedArms("with"), ["with"]);
    assert.deepEqual(selectedArms("both"), ["without", "with"]);
  });

  it("returns [] for invalid values", () => {
    for (const bad of [undefined, null, "", "WITHOUT", "all", 0, {}, []]) {
      assert.deepEqual(selectedArms(bad), [], JSON.stringify(bad));
    }
  });
});

describe("canSubmitTarget", () => {
  it("accepts a ready single target", () => {
    assert.equal(canSubmitTarget(submitBase()), true);
  });

  it("requires every selected arm ready with an empty approvals array", () => {
    const approval = makeApproval();
    // Selected arm awaiting approval blocks submit.
    assert.equal(
      canSubmitTarget(
        submitBase({ state: makeState({ arms: { without: { status: "approval", approvals: [approval] } } }) }),
      ),
      false,
    );
    // Selected arm working blocks submit.
    assert.equal(
      canSubmitTarget(
        submitBase({ state: makeState({ arms: { without: { status: "running", approvals: [] } } }) }),
      ),
      false,
    );
    // Missing approvals array blocks submit even when status is ready.
    assert.equal(
      canSubmitTarget(
        submitBase({ state: makeState({ arms: { without: { status: "ready" } } }) }),
      ),
      false,
    );
    // Empty approvals array is required, not just any array.
    assert.equal(
      canSubmitTarget(
        submitBase({ state: makeState({ arms: { without: { status: "ready", approvals: [approval] } } }) }),
      ),
      false,
    );
  });

  it("isolates targets: unselected arm may be approval/running", () => {
    const busy = makeState({
      arms: {
        without: { status: "ready", approvals: [] },
        with: { status: "running", approvals: [] },
      },
    });
    assert.equal(canSubmitTarget(submitBase({ state: busy, target: "without" })), true);
    assert.equal(canSubmitTarget(submitBase({ state: busy, target: "with" })), false);
    assert.equal(canSubmitTarget(submitBase({ state: busy, target: "both" })), false);

    const otherApproval = makeState({
      arms: {
        without: { status: "ready", approvals: [] },
        with: { status: "approval", approvals: [makeApproval()] },
      },
    });
    assert.equal(canSubmitTarget(submitBase({ state: otherApproval, target: "without" })), true);
    assert.equal(canSubmitTarget(submitBase({ state: otherApproval, target: "both" })), false);
  });

  it("rejects bad text, link state and invalid values", () => {
    assert.equal(canSubmitTarget(submitBase({ text: "   " })), false);
    assert.equal(canSubmitTarget(submitBase({ text: "" })), false);
    assert.equal(canSubmitTarget(submitBase({ text: null })), false);
    assert.equal(canSubmitTarget(submitBase({ text: "x".repeat(14001) })), false);
    assert.equal(canSubmitTarget(submitBase({ text: "x".repeat(14000) })), true);
    assert.equal(canSubmitTarget(submitBase({ connected: false })), false);
    assert.equal(canSubmitTarget(submitBase({ pending: true })), false);
    assert.equal(canSubmitTarget(submitBase({ uncertain: true })), false);
    assert.equal(canSubmitTarget(submitBase({ state: makeState({ status: "working" }) })), false);
    assert.equal(canSubmitTarget(submitBase({ target: "nope" })), false);
    assert.equal(canSubmitTarget(submitBase({ state: null })), false);
  });
});

describe("approvalFingerprint", () => {
  it("is stable for identical approvals", () => {
    const a = makeApproval();
    const b = makeApproval();
    assert.equal(approvalFingerprint(a), approvalFingerprint(b));
    assert.equal(typeof approvalFingerprint(a), "string");
  });

  it("changes when command or requirements change", () => {
    const base = approvalFingerprint(makeApproval());
    assert.notEqual(approvalFingerprint(makeApproval({ command: "pwd" })), base);
    assert.notEqual(approvalFingerprint(makeApproval({ sourceIndex: 1 })), base);
    assert.notEqual(
      approvalFingerprint(makeApproval({ approvalId: "appr-2", requirementId: {approvalId:"appr-2",sourceIndex:0} })),
      base,
    );
  });

  it("rejects duplicate choice IDs", () => {
    assert.equal(
      approvalFingerprint(
        makeApproval({ choices: [{ choiceId: "x", label: "A" }, { choiceId: "x", label: "B" }] }),
      ),
      null,
    );
  });

  it("rejects empty/missing arrays and mismatched IDs", () => {
    assert.equal(approvalFingerprint(makeApproval({ choices: [] })), null);
    const { choices, ...noChoices } = makeApproval();
    assert.equal(approvalFingerprint(noChoices), null);
    // Snapshot shape uses requirementId; mismatched or aliased IDs fail.
    assert.equal(approvalFingerprint(makeApproval({ requirementId: "other" })), null);
    assert.equal(approvalFingerprint(makeApproval({ approvalId: "other" })), null);
    assert.equal(approvalFingerprint({ ...makeApproval(), requirementId: undefined }), null);
  });

  it("rejects non-review status and invalid values", () => {
    assert.equal(approvalFingerprint(makeApproval({ status: "approved" })), null);
    assert.equal(approvalFingerprint(makeApproval({ status: "running" })), null);
    assert.equal(approvalFingerprint(makeApproval({ sourceIndex: -1 })), null);
    assert.equal(approvalFingerprint(makeApproval({ sourceIndex: 1.5 })), null);
    assert.equal(approvalFingerprint(makeApproval({ command: "" })), null);
    assert.equal(approvalFingerprint(makeApproval({ command: "x".repeat(14001) })), null);
    assert.equal(approvalFingerprint(makeApproval({ approvalId: "" })), null);
    assert.equal(approvalFingerprint(null), null);
    assert.equal(approvalFingerprint({}), null);
  });
});

describe("canDecideCurrent", () => {
  function decideState(arm = "without", stored = [makeApproval()]) {
    return makeState({ arms: { [arm]: { status: "approval", approvals: stored } } });
  }

  function decideBase(overrides = {}) {
    return {
      state: decideState(),
      arm: "without",
      approval: makeApproval(),
      choiceId: "yes",
      connected: true,
      pending: false,
      ...overrides,
    };
  }

  it("accepts a live approval/choice pair", () => {
    assert.equal(canDecideCurrent(decideBase()), true);
  });

  it("a send to an unrelated arm must not disable approval decisions", () => {
    const state = makeState({
      arms: {
        without: { status: "approval", approvals: [makeApproval()] },
        with: { status: "running", approvals: [] },
      },
    });
    assert.equal(canDecideCurrent(decideBase({ state })), true);
  });

  it("rejects stale choice IDs", () => {
    assert.equal(canDecideCurrent(decideBase({ choiceId: "maybe" })), false);
    assert.equal(canDecideCurrent(decideBase({ choiceId: "" })), false);
  });

  it("rejects changed command/requirements (stale fingerprint)", () => {
    const state = decideState("without", [makeApproval({ command: "pwd" })]);
    assert.equal(canDecideCurrent(decideBase({ state, approval: makeApproval() })), false);
    const moved = decideState("without", [makeApproval({ sourceIndex: 2 })]);
    assert.equal(canDecideCurrent(decideBase({ state: moved })), false);
  });

  it("rejects disconnected, pending and invalid values", () => {
    assert.equal(canDecideCurrent(decideBase({ connected: false })), false);
    assert.equal(canDecideCurrent(decideBase({ connected: undefined })), false);
    assert.equal(canDecideCurrent(decideBase({ pending: true })), false);
    assert.equal(canDecideCurrent(decideBase({ arm: "both" })), false);
    assert.equal(canDecideCurrent(decideBase({ arm: "nope" })), false);
    assert.equal(
      canDecideCurrent(decideBase({ state: makeState({ status: "working" }) })),
      false,
    );
    // Arm selected for working (not approval) cannot decide.
    assert.equal(
      canDecideCurrent(decideBase({ state: makeState() })),
      false,
    );
    // Empty/missing stored approvals cannot decide.
    assert.equal(canDecideCurrent(decideBase({ state: decideState("without", []) })), false);
    assert.equal(
      canDecideCurrent(
        decideBase({ state: makeState({ arms: { without: { status: "approval" } } }) }),
      ),
      false,
    );
    // Invalid supplied approval never decides.
    assert.equal(canDecideCurrent(decideBase({ approval: null })), false);
  });
});

import {isNewSessionGeneration,approvalRequirementKey} from '../web/session-controls.mjs';
test('uncertainty resets only for a confirmed newer pair generation',()=>{assert.equal(isNewSessionGeneration(2,2),false);assert.equal(isNewSessionGeneration(2,1),false);assert.equal(isNewSessionGeneration(2,3),true);assert.equal(isNewSessionGeneration(0,undefined),false);});
test('cosmetic choice changes cannot unlock the same approval requirement',()=>{const a={approvalId:'a',requirementId:{approvalId:'a',sourceIndex:0},choices:[{choiceId:'allow',label:'Allow once'}]};assert.equal(approvalRequirementKey(a),approvalRequirementKey({...a,choices:[{choiceId:'allow',label:'Allow now'}]}));assert.notEqual(approvalRequirementKey(a),approvalRequirementKey({...a,requirementId:{approvalId:'a',sourceIndex:1}}));});
test('encoded HTTP budget rejects large Unicode and escaped text before send',()=>{const args={state:{status:'ready',arms:{without:{status:'ready',approvals:[]},with:{status:'ready',approvals:[]}}},target:'both',connected:true,pending:false,uncertain:false};assert.equal(canSubmitTarget({...args,text:'🌿'.repeat(6500)}),false);assert.equal(canSubmitTarget({...args,text:'"'.repeat(13000)}),false);assert.equal(canSubmitTarget({...args,text:'señal 🌿'}),true);});


import {expectedTurnBindings,canInterruptSelected,interruptionSettlement} from '../web/session-controls.mjs';
test('working send and interrupt bind selected native turns without resolving approvals',()=>{
 const approval=makeApproval(),state={status:'ready',session_generation:7,arms:{without:{status:'ready',approvals:[]},with:{status:'approval',active_turn_id:'native-1',interrupt_pending:false,approvals:[approval]}}};
 assert.equal(canSubmitTarget(submitBase({state,target:'both'})),true);
 assert.deepEqual(expectedTurnBindings(state,'both'),{without:null,with:'native-1'});
 assert.equal(canInterruptSelected({state,target:'both',connected:true,pending:false}),true);
 assert.equal(canInterruptSelected({state,target:'without',connected:true,pending:false}),false);
 assert.equal(canDecideCurrent({state,arm:'with',approval,choiceId:'yes',connected:true,pending:false}),true,'steering is separate from command approval');
 state.arms.with.interrupt_pending=true;
 assert.equal(canSubmitTarget(submitBase({state,target:'with'})),false);
 assert.equal(canInterruptSelected({state,target:'both',connected:true,pending:false}),false);
 assert.equal(canSubmitTarget(submitBase({state,target:'without'})),true);
});
test('working send fails closed without a native turn or while offline; no Presence gate',()=>{
 for(const status of ['running','question','approval']){
  const state={status:'ready',arms:{with:{status,active_turn_id:'current',approvals:[]}}};
  assert.equal(canSubmitTarget(submitBase({state,target:'with'})),true);
  delete state.arms.with.active_turn_id;assert.equal(canSubmitTarget(submitBase({state,target:'with'})),false);
 }
});
test('interrupt admission never means native work has ended or closes a session',()=>{
 const attempt={generation:7,expectedTurns:{without:null,with:'turn-1'}};
 const state={session_generation:7,arms:{with:{status:'running',active_turn_id:'turn-1',interrupt_pending:true,last_turn_terminal:null}}};
 assert.equal(interruptionSettlement(state,attempt),'pending');
 state.arms.with={status:'ready',active_turn_id:null,last_turn_terminal:'cancelled'};
 assert.equal(interruptionSettlement(state,attempt),'ended');
 state.arms.with.last_turn_terminal='completed';assert.equal(interruptionSettlement(state,attempt),'ended','completion may win the interrupt race');
 state.arms.with.status='closed';assert.equal(interruptionSettlement(state,attempt),'unconfirmed');
 state.session_generation=8;assert.equal(interruptionSettlement(state,attempt),'superseded');
});


test('fresh pairs select Both; later snapshots preserve deliberate recipient selection',async()=>{
 const {recipientTargetForGeneration}=await import('../web/session-controls.mjs');
 for(const target of ['without','with','both']){
  assert.equal(recipientTargetForGeneration(target,0,1),'both');
  assert.equal(recipientTargetForGeneration(target,4,5),'both');
  assert.equal(recipientTargetForGeneration(target,5,5),target);
  assert.equal(recipientTargetForGeneration(target,5,4),target);
 }
});
