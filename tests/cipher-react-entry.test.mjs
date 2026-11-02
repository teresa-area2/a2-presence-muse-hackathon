import test from 'node:test';
import assert from 'node:assert/strict';
import {mountCipherTextarea} from '../integrations/cipher-textbox/entry.mjs';

test('a synchronous React root failure removes the temporary host',async()=>{
 const previous=globalThis.document,children=[];
 const parent={appendChild(host){children.push(host);}};
 globalThis.document={createElement(){return{nodeType:0,remove(){const index=children.indexOf(this);if(index>=0)children.splice(index,1);}};}};
 try{await assert.rejects(mountCipherTextarea({tagName:'TEXTAREA',parentElement:parent},{}));assert.equal(children.length,0);}
 finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
