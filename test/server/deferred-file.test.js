import test from 'node:test';
import assert from 'node:assert/strict';
import {HTML} from '../../src/server/index.js';
test('304 skips nested content, removes rendered, and continues rendering siblings',async()=>{
 const calls=[];
 const result=await HTML({file:{src:'<main><section src="/deferred.html" rendered render-error></section><aside src="/sibling.html"></aside></main>',pathname:'/index.html'},urlObject:new URL('https://example.test/'),resolveFile:async path=>{
 calls.push(path);
 return path==='/deferred.html'?{status:304,src:'<div src="/must-not-fetch.html">DEFERRED</div>'}:{status:200,src:'SIBLING'};
 }});
 assert.deepEqual(calls,['/deferred.html','/sibling.html']);
 assert.match(result,/<section[^>]*src="\/deferred.html"[^>]*error="304"/);
 assert.doesNotMatch(result.match(/<section[^>]*>/)[0],/\srendered(?:\s|=|>)/);
 assert.doesNotMatch(result,/DEFERRED/);assert.match(result,/SIBLING/);
});
