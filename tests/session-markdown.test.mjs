import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMarkdown} from '../web/transcript-notice.mjs';
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.attributes={};this._text='';}
 append(...nodes){this.children.push(...nodes);}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
 setAttribute(key,value){this.attributes[key]=String(value);}
}
const doc={createElement:tag=>new Element(tag),createDocumentFragment:()=>new Element('fragment'),createTextNode:text=>{const node=new Element('#text');node.textContent=text;return node;}};
const all=(node,tag)=>[...(node.tag===tag?[node]:[]),...node.children.flatMap(child=>all(child,tag))];
const render=text=>renderMarkdown(doc,text);

test('callouts preserve emphasized facts and neighboring prose as inert content',()=>{
 const root=render('Plan.\n\n> **Decision:** keep unsaved edits.\n> Retry once; keep the original draft.\n\nActual checks: not run.');
 assert.equal(all(root,'blockquote').length,1);assert.equal(all(root,'strong')[0].textContent,'Decision:');
 for(const text of ['Plan.','keep unsaved edits.','Retry once; keep the original draft.','Actual checks: not run.'])assert.ok(root.textContent.includes(text));
 assert.equal(root.children.at(-1).tag,'p');
});
test('a callout adjacent to ordinary prose starts its own block',()=>{
 const root=render('Result: saved.\n> **Risk:** retry can fail.\n\nNext action.');
 assert.equal(all(root,'blockquote').length,1);assert.equal(root.children[0].textContent,'Result: saved.');
});
test('compact comparison tables keep every header, cell and following paragraph',()=>{
 const root=render('| Path | Save calls |\n| --- | ---: |\n| Success | `1` |\n| Conflict | At most **2** |\n\nThe second failure propagates.');
 assert.equal(all(root,'table').length,1);assert.deepEqual(all(root,'th').map(n=>n.textContent),['Path','Save calls']);
 assert.deepEqual(all(root,'td').map(n=>n.textContent),['Success','1','Conflict','At most 2']);assert.ok(root.textContent.includes('The second failure propagates.'));
});
test('table parsing respects escaped pipes and inline code; ordinary pipes are plain text',()=>{
 const table=render('| Expression | Note |\n| --- | --- |\n| `a | b` | escaped \\| pipe |');
 assert.deepEqual(all(table,'td').map(n=>n.textContent),['a | b','escaped | pipe']);
 const ordinary='Use a | b; this is not a table.\nNext line.';assert.equal(all(render(ordinary),'table').length,0);assert.ok(render(ordinary).textContent.includes('Use a | b; this is not a table.'));
 const invalid=render('| A | B |\n| --- | --- |\n| extra | cells | stay visible |');assert.ok(invalid.textContent.includes('| extra | cells | stay visible |'));
});
test('diagram/code fences preserve geometry and do not become callouts or tables',()=>{
 const body='save -> conflict?\n          | yes\n          v\n       fetch -> merge -> retry once\n> literal quote marker\n| literal | table |\n| --- | --- |';
 const root=render('```text\n'+body+'\n```');assert.equal(all(root,'pre').length,1);assert.equal(all(root,'code')[0].textContent,body);assert.equal(all(root,'table').length,0);assert.equal(all(root,'blockquote').length,0);
});
test('untrusted callout/table HTML and unsafe links never become active markup',()=>{
 const root=render('> <img src=x onerror=alert(1)>\n> [bad](javascript:alert)\n\n| X | Y |\n| --- | --- |\n| <script>bad</script> | [safe](https://example.com) |');
 assert.equal(all(root,'script').length,0);assert.equal(all(root,'img').length,0);assert.ok(root.textContent.includes('<script>bad</script>'));assert.ok(root.textContent.includes('[bad](javascript:alert)'));assert.equal(all(root,'a').length,1);assert.equal(all(root,'a')[0].rel,'noopener noreferrer');
});
