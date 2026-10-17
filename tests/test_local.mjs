// Node.js 22: node --experimental-vm-modules tests/test_local.mjs
// DOM/storage mocks run app logic; this is not a real browser or Firebase integration test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html={value:''};const handlers={};
const fakeApp={addEventListener:(n,fn)=>handlers[n]=fn, get innerHTML(){return html.value;},set innerHTML(v){html.value=v;}};
let snapshot=null;const queue=[];
let num=0;let pendingTimer=0;
const fakeStorage={
 loadLocal:async()=>({data:snapshot,queue:queue.slice()}),
 saveSnapshot:async d=>{snapshot=structuredClone(d)},
 persistChange:async(d,q)=>{snapshot=structuredClone(d);if(q)queue.push(q)},
 removeOutbox:async id=>{const i=queue.findIndex(x=>x.id===id);if(i>=0)queue.splice(i,1)},
 clearAll:async()=>{snapshot=null;queue.length=0;},clearOutbox:async()=>{queue.length=0;}
};
const doc={
 querySelector:s=>s==='#app'?fakeApp:null,
 getElementById:s=>s==='slot-jump'?{value:'200'}:null,
 activeElement:{tagName:'BODY'},
 body:{appendChild:()=>{}},createElement:()=>({click:()=>{},remove:()=>{}}),
};
const win={addEventListener:(n,fn)=>{handlers[`window_${n}`]=fn}};
const context=vm.createContext({
 document:doc,window:win,location:{search:''},URLSearchParams,URL:class extends URL{static createObjectURL=()=> 'blob:test';static revokeObjectURL=()=>{};},
 FormData:class{constructor(form){this.values=form.values||{};}get(key){return this.values[key]??null;}},
 console,Date,JSON,Math,Number,String,Object,Array,Boolean,Error,Promise,Map,Set,
 Blob,performance:{now:()=>{pendingTimer+=1534.81;return pendingTimer;}},
 sessionStorage:{getItem:()=>null,setItem:()=>{}},
 globalThis:{crypto:{randomUUID:()=>`00000000-0000-0000-0000-${String(++num).padStart(12,'0')}`}},
 setInterval:()=>0,setTimeout:()=>0,confirm:()=>true,structuredClone
});
const modules=new Map();
const load=f=>{
 if(modules.has(f))return modules.get(f);
 let module;
 if(f==='js/storage.js'){
   module=new vm.SyntheticModule(Object.keys(fakeStorage),function(){for(const [key,value] of Object.entries(fakeStorage))this.setExport(key,value)},{context});
 }else if(f==='js/cloud.js'){
   module=new vm.SyntheticModule(['isConfigured','createCloud'],function(){this.setExport('isConfigured',()=>false);this.setExport('createCloud',()=>{throw Error('Apps Script not configured')})},{context});
 }else{
   module=new vm.SourceTextModule(fs.readFileSync(path.join(root,f),'utf8'),{context,identifier:f});
 }
 modules.set(f,module);return module;
};
const main=load('js/app.js');
await main.link(async(spec,parent)=>load(path.posix.normalize(path.posix.join(path.posix.dirname(parent.identifier),spec))));
await main.evaluate();
await new Promise(r=>setImmediate(r));
const press=async action=>handlers.click({target:{closest:s=>s==='[data-action]'?{dataset:{action}}:null}});
const change=async (id,value)=>handlers.change({target:{id,value}});
const info=()=>({runs:Object.values(snapshot?.runs||{}),participants:Object.keys(snapshot?.participants||{}).length,teams:Object.keys(snapshot?.teams||{}).length});
assert.match(html.value,/2026 연천피지컬 서바이벌/);
assert.match(html.value,/서버 미연결 · 기기 저장/);
assert.doesNotMatch(html.value,/체험판|체험 모드|LOCAL DEMO/);
assert.equal(info().participants,0,'preset participants generated in-memory and not stored until first write');
for(let i=1;i<=200;i++){
 await press('start');await press('finish');
 const x=info().runs;
 assert.equal(x.length,i,`individual ${i} result count`);
 assert.equal(x[i-1].targetId,`p_${String(i).padStart(3,'0')}`);
 assert.equal(x[i-1].status,'finished');
 assert(x[i-1].elapsedMs>=0);
}
assert.match(html.value,/200.*200/s);
await change('race-type','relay');
for(let i=1;i<=50;i++){
 await press('start');await press('finish');
 const x=info().runs;
 assert.equal(x.length,200+i,`relay ${i} result count`);
 assert.equal(x[199+i].targetId,`t_${String(i).padStart(2,'0')}`);
 assert.equal(x[199+i].status,'finished');
}
assert.equal(info().runs.length,250);
await press('start'); // after 50 teams complete, cannot start 01 again
assert.equal(info().runs.length,250,'completed slot must not restart');
await change('race-type','individual');
await press('start');
assert.equal(info().runs.length,250,'completed slot must not restart');
assert.equal(queue.length,0,'local mode must not claim unsent Firebase records');
console.log('PASS 250 sequential timing records, fixed slots 200+50, already-finished guard, local status, zero server outbox');

// 초기화: 백업 확인 + 확인 문구 필수 / 개인전만 초기화해도 계주 기록은 유지
await press('open-reset');
await press('export-json');
const submitReset=async(scope,backup='on',phrase='기록초기화')=>{await handlers.submit({preventDefault(){},target:{getAttribute:n=>n==='id'?'reset-form':null,values:{scope,backup,phrase}}});};
await submitReset('individual');
assert.equal(info().runs.length,50,'only relay runs remain after individual reset');
assert.equal(Object.keys(snapshot.participants||{}).length,200);
assert.equal(Object.keys(snapshot.teams||{}).length,50);
assert.equal(snapshot.meta.generation,1);
await press('open-reset');await press('export-json');await submitReset('all');
assert.equal(info().runs.length,0,'all results cleared after full reset');
assert.equal(snapshot.meta.generation,2);
assert.equal(Object.keys(snapshot.participants).length,200);
assert.equal(Object.keys(snapshot.teams).length,50);
console.log('PASS backup-gated individual reset preserves relay records, full reset clears all records, 200/50 slots preserved');
