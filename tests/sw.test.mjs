import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('an interrupted update preserves the complete old version until the new version is ready',async()=>{
  const source=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
  const buckets=new Map([['feature-lens-old',new Map([['old-shell',{ok:true,type:'basic'}]])]]);
  const caches={
    open:async name=>{
      if(!buckets.has(name))buckets.set(name,new Map());
      return {put:async(url,response)=>buckets.get(name).set(url,response),match:async url=>buckets.get(name).get(url)};
    },
    delete:async name=>buckets.delete(name),
    keys:async()=>[...buckets.keys()],
  };
  const handlers=new Map(),scope='https://example.test/webcam-feature-viewer/';
  let fail=true,skips=0,claims=0,requests=0;
  const self={registration:{scope,active:{}},location:{origin:'https://example.test'},clients:{claim:async()=>claims++},skipWaiting:async()=>skips++,addEventListener:(name,fn)=>handlers.set(name,fn)};
  const fetch=async url=>{
    requests++;
    if(fail&&url.endsWith('/vision.js'))throw new Error('connection lost');
    return {ok:true,type:'basic',url};
  };
  runInNewContext(source,{self,caches,fetch,URL,Promise});
  const emit=(name,data)=>{
    let task;
    handlers.get(name)({data,waitUntil:promise=>task=promise});
    return task;
  };
  await assert.rejects(emit('install'),/connection lost/);
  assert(buckets.has('feature-lens-old'));
  assert(!buckets.has('feature-lens-__BUILD_ID__'));
  assert.equal(skips,0);
  fail=false;
  await emit('install');
  assert(buckets.has('feature-lens-old'));
  assert(buckets.has('feature-lens-__BUILD_ID__'));
  assert.equal(skips,0);
  await emit('message',{type:'SKIP_WAITING'});
  assert.equal(skips,1);
  await emit('activate');
  assert(!buckets.has('feature-lens-old'));
  assert.equal(claims,1);
  assert(requests>10);
});
