import test from 'node:test';
import assert from 'node:assert/strict';
import {describeObserverResponse, compareObserverResponses, observerExcerpt, validateObserverExcerpt} from '../src/observer-comparison.mjs';

test('contrasting synthetic answers describe navigation beyond word counts',()=>{
 const prose='Save once.\n\nIf a conflict occurs, keep the current draft and ask before replacing it.';
 const structured='## Decision\nKeep the current draft.\n\n1. Fetch the saved version.\n2. Compare changed fields.\n\n**Risk:** overlapping changes need review.\n\n```js\nconst question = "?";\n```';
 const a=describeObserverResponse(prose),b=describeObserverResponse(structured);
 assert.equal(a.status,'observed');assert.equal(a.headings,0);assert.equal(b.headings,1);assert.equal(b.ordered_items,2);assert.equal(b.code_blocks,1);assert.equal(b.question_marks,0);assert.equal(b.emphasis_spans,1);
 const diff=compareObserverResponses({without:prose,with:structured});assert.equal(diff.status,'different');assert.ok(diff.differences.includes('ordered_items'));assert.ok(diff.differences.includes('headings'));assert.equal(diff.depth,'unverified');assert.equal(diff.conversation_quality,'unverified');
});
test('same features are explicitly no detected structural difference, never equal quality',()=>{
 const out=compareObserverResponses({without:'Keep the draft.',with:'Save the version.'});assert.equal(out.status,'no_detected_difference');assert.deepEqual(out.differences,[]);assert.equal(out.depth,'unverified');
});
test('missing/oversized text is unavailable rather than a zero observation or truncated proof',()=>{
 assert.equal(describeObserverResponse(null).status,'unavailable');assert.equal(describeObserverResponse('').status,'unavailable');assert.equal(describeObserverResponse('x'.repeat(24001)).status,'unavailable');assert.equal(compareObserverResponses({without:null,with:'Hello.'}).status,'unavailable');
});
test('questions in fenced/inline code are not conversational evidence; punctuation is descriptive',()=>{
 const d=describeObserverResponse('Which file should change?\n\n`isReady ? yes : no`\n\n```js\n// ?\n```');assert.equal(d.question_marks,1);
});
test('bounded local excerpts retain exact offsets and fail closed on forged quotes',()=>{
 const source='αβ Start.\n<script>synthetic text</script> End.';
 const quote=observerExcerpt(source,{start:3,maxChars:24});assert.equal(quote.text,source.slice(quote.start,quote.end));assert.ok(quote.text.length<=24);assert.equal(validateObserverExcerpt(source,quote),true);assert.equal(validateObserverExcerpt(source,{...quote,text:'forged'}),false);assert.equal(validateObserverExcerpt(source,{...quote,start:quote.start+1}),false);assert.equal(observerExcerpt(null),null);assert.equal(validateObserverExcerpt(null,quote),false);
});
test('code fence contents, ordinary pipes and blank text cannot become prose evidence',()=>{
 assert.equal(describeObserverResponse(' \n ').status,'unavailable');
 assert.equal(describeObserverResponse('Use left | right as text.').table_rows,0);
 const d=describeObserverResponse('```js\n```not-a-close\n# not a heading\nWhy?\n```');
 assert.equal(d.headings,0);assert.equal(d.question_marks,0);
 assert.equal(describeObserverResponse('| Arm | Calls |\n| --- | --- |\n| With | 2 |').table_rows,2);
});
test('callout labels, diagram-marked fences and table comparisons remain descriptive',()=>{
 const d=describeObserverResponse('**Decision:** preserve the draft.\n\n> [!NOTE]\n> Review overlaps.\n\n```mermaid\nflowchart LR\n A-->B\n # not prose?\n```\n\n| Arm | Calls |\n| --- | --- |\n| With | 2 |');
 assert.equal(d.callout_lines,2);assert.equal(d.diagram_blocks,1);assert.equal(d.table_rows,2);assert.equal(d.question_marks,0);assert.equal(d.headings,0);
 const c=compareObserverResponses({without:'Preserve the draft.',with:'**Decision:** preserve the draft.'});assert.ok(c.differences.includes('callout_lines'));assert.equal(c.depth,'unverified');
});

test('table observations require valid comparable cells and ignore escaped/code-only pipes',()=>{
 assert.equal(describeObserverResponse('`a|b`\n`---|---`').table_rows,0);
 assert.equal(describeObserverResponse('| A | B |\n| --- | --- |\n| valid | yes |\n| malformed | extra | cells |').table_rows,2);
 assert.equal(describeObserverResponse('| Expr | Note |\n| --- | --- |\n| `a | b` | escaped \\| pipe |').table_rows,2);
});
