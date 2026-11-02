import test from 'node:test';
import assert from 'node:assert/strict';
import {HTML} from '../../src/server/index.js';
test('SSR without an authorized resolver cannot include private or legacy-public content',async()=>{
 for(const file of [{headers:{'Cache-Control':'public, must-revalidate'}},{public:true},{headers:{'Cache-Control':'private'}},{headers:{'Cache-Control':'no-store, must-revalidate'}}]){
 const result=await HTML({file:{src:'<div src="/secret.html" render-error></div>',pathname:'/index.html'},urlObject:new URL('https://example.test/'),crud:{send:async()=>({object:[{...file,src:'SECRET-CONTENT'}]})}});
 assert.doesNotMatch(result,/SECRET-CONTENT/);assert.match(result,/error="403"/);
 }
});
