import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

async function setup(fetchImpl=async()=>new Response('network',{headers:{'content-type':'application/javascript'}})) {
  const handlers={}, deleted=[], cache=new Map();let skipped=false;
  const context={URL,Response,fetch:fetchImpl,caches:{open:async()=>({match:async key=>cache.get(key),put:async(key,value)=>cache.set(key,value)}),keys:async()=>['single-point-v7','single-point-v8','unrelated-cache'],delete:async key=>deleted.push(key)},self:{location:{origin:'https://test.example'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{skipped=true},clients:{claim:async()=>{}}}};
  vm.runInNewContext(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'),context);
  return{handlers,cache,deleted,skipped:()=>skipped};
}
test('service worker deletes only obsolete caches owned by this application',async()=>{
  const s=await setup();let promise;s.handlers.activate({waitUntil:p=>promise=p});await promise;assert.deepEqual(s.deleted,['single-point-v7','single-point-v8']);
});
test('API, unrelated assets and cross-origin requests are never intercepted',async()=>{
  const s=await setup();
  for(const url of ['https://test.example/api/deepseek','https://test.example/missing.js','https://other.example/a.js']){
    let handled=false;s.handlers.fetch({request:{url,method:'GET',mode:'cors'},respondWith:()=>handled=true});assert.equal(handled,false);
  }
});
test('offline navigation gets app HTML, scripts get only their own asset',async()=>{
  const s=await setup(async()=>{throw Error('offline')});s.cache.set('/mobile.html',new Response('<html>App</html>'));s.cache.set('/learning.js',new Response('JS'));
  for(const [path,mode,expected] of [['/','navigate','<html>App</html>'],['/learning.js','cors','JS']]){
    let promise;s.handlers.fetch({request:{url:'https://test.example'+path,method:'GET',mode},respondWith:p=>promise=p});assert.equal(await(await promise).text(),expected);
  }
  let missing;s.handlers.fetch({request:{url:'https://test.example/mobile-bridge.js',method:'GET',mode:'cors'},respondWith:p=>missing=p});await assert.rejects(missing,/offline/);
});
test('redirected sign-in response cannot activate a broken offline update',async()=>{
  const s=await setup(async()=>({ok:true,redirected:true,headers:new Headers()}));let promise;s.handlers.install({waitUntil:p=>promise=p});await assert.rejects(promise,/Incomplete/);assert.equal(s.cache.size,0);assert.equal(s.skipped(),false);
});
