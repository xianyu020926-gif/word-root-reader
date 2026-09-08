import assert from 'node:assert/strict';
import test from 'node:test';
const {GET,POST}=await import('../app/api/deepseek/route.ts');
const article='The harvest was plentiful. We stored the grain.';
const input={source_text:article,user_selected_words:['harvest'],selected_contexts:{harvest:{paragraph:article,sentence:'The harvest was plentiful.'}}};
const card=()=>({surface:'harvest',context_meaning_zh:'收成',core_meaning_zh:'收获',context_evidence:'The harvest',structure_type:'direct',structure_confidence:'low',structure_basis_zh:'直接记忆',morphology:[{part:'harvest',type:'base',meaning_zh:'收获'}],memory_hint_zh:'记住田里的收成',word_family:[],status:'candidate'});
async function request(operation,input,result,inspect=()=>{}){
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,options)=>{
    calls++;
    assert.equal(url,'https://api.deepseek.com/chat/completions');inspect(JSON.parse(options.body));
    return Response.json({choices:[{message:{content:JSON.stringify(result)}}]});
  };
  try{const response=await POST(new Request('http://localhost/api/deepseek',{method:'POST',headers:{'content-type':'application/json','x-deepseek-key':'test-only-not-real'},body:JSON.stringify({operation,input})}));assert.equal(calls,1,'Expected isolated mock provider call');return response}
  finally{globalThis.fetch=original}
}
test('word request retains full article and exact user-selected sentence',async()=>{
  const response=await request('enrichWords',input,{words:[card()]},body=>{const task=JSON.parse(body.messages[1].content);assert.equal(task.source_text,article);assert.deepEqual(task.selected_contexts,input.selected_contexts)});
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.words[0].context_meaning_zh,'收成');
});
test('duplicate or empty cards rejected before reaching learner',async()=>{
  for(const result of [{words:[card(),card()]},{words:[{...card(),context_meaning_zh:''}]},{words:[]}]){
    const response=await request('enrichWords',input,result);assert.equal(response.status,400);
  }
});
test('invented source evidence is rejected',async()=>{
  const response=await request('enrichWords',input,{words:[{...card(),context_evidence:'A fictional harvest'}]});assert.equal(response.status,400);
});
test('grammar teacher receives full article and rejects evidence outside current sentence',async()=>{
  const focus='The harvest was plentiful.';
  const response=await request('askTeacher',{source_text:article,focus_sentence:focus,question:'解释语法',conversation:[]},{answer:'解释',evidence_quote:'We stored the grain.',confidence:'high'},body=>{const task=JSON.parse(body.messages[1].content);assert.equal(task.source_text,article);assert.equal(task.focus_sentence,focus)});
  assert.equal(response.status,400);
});
test('backend reports managed-key mode without revealing a secret',async()=>{
  const original=process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY='managed-test-key';
  try{
    const response=await GET(),body=await response.json();
    assert.deepEqual(body,{managedKey:true,managedModel:false});
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(JSON.stringify(body).includes('managed-test-key'),false);
  }finally{
    if(original===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=original;
  }
});
test('managed server key can replace the per-device key',async()=>{
  const original=process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY='managed-test-key';
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async(_url,options)=>{
    assert.equal(options.headers.Authorization,'Bearer managed-test-key');
    return Response.json({choices:[{message:{content:JSON.stringify({words:[card()]})}}]});
  };
  try{
    const response=await POST(new Request('http://localhost/api/deepseek',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation:'enrichWords',input})}));
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  }finally{
    globalThis.fetch=oldFetch;
    if(original===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=original;
  }
});
