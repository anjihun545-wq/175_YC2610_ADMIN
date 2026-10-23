// Simulated DOM interactions, not a real Chromium test.
import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const handlers={},app={addEventListener:(name,cb)=>handlers[name]=cb,innerHTML:''};
let localSnapshot=null,serial=0;
const store={loadLocal:async()=>({data:localSnapshot,queue:[]}),saveSnapshot:async o=>{localSnapshot=structuredClone(o)},persistChange:async(o)=>{localSnapshot=structuredClone(o)},removeOutbox:async()=>{},clearAll:async()=>{localSnapshot=null},clearOutbox:async()=>{}};
const document={getElementById:id=>id==='app'?app:null,querySelector:selector=>selector==='#app'?app:null,activeElement:{tagName:'BODY'}};
const context=vm.createContext({document,window:{addEventListener:(name,cb)=>handlers[`window_${name}`]=cb},location:{search:''},URLSearchParams,URL,console,Date,JSON,Math,Number,String,Object,Array,Boolean,Error,Promise,Map,Set,Blob,FormData,performance:{now:()=>++serial*1000},sessionStorage:{getItem:()=>null,setItem:()=>{}},globalThis:{crypto:{randomUUID:()=>`00000000-0000-0000-0000-${String(++serial).padStart(12,'0')}`}},setInterval:()=>{},setTimeout:()=>{},confirm:()=>true,structuredClone});
const modules=new Map();function load(file){if(modules.has(file))return modules.get(file);let mod;
 if(file==='js/storage.js'||file==='js/cloud.js'){
 const exports=file==='js/storage.js'?store:{isConfigured:()=>false,createCloud:async()=>null};
 mod=new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v]of Object.entries(exports))this.setExport(k,v)},{context});
 }else mod=new vm.SourceTextModule(fs.readFileSync(path.join(root,file),'utf8'),{context,identifier:file});
 modules.set(file,mod);return mod;}
const main=load('js/app.js');await main.link(async(spec,parent)=>load(path.posix.normalize(path.posix.join(path.posix.dirname(parent.identifier),spec))));await main.evaluate();
const idle=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
const click=async(action,target=null)=>{handlers.click({target:{closest:s=>s==='[data-action]'?{dataset:{action,target}}:null}});await idle();};
await idle();assert.match(app.innerHTML,/두 선수 동시 시작/);
await click('start-heat');assert.equal(Object.keys(localSnapshot.runs).length,2);
assert.equal(localSnapshot.status.current.runIds.length,2);
await click('finish-lane','p_002');assert.equal(localSnapshot.runs[localSnapshot.status.current.runIds[0]].targetId,'p_001');
await click('finish-lane','p_001');assert.equal(Boolean(localSnapshot.status.current),false);
assert.equal(Object.values(localSnapshot.runs).filter(x=>x.status==='finished').length,2);
assert.match(app.innerHTML,/M002/);
await click('relay-start'); // no-op in other tab, shortcut behavior is UI-only; direct relay action still updates internal stopwatch
await click('relay-stop');await click('relay-reset');
assert.match(app.innerHTML,/남자/);
console.log('PASS mock app: paired start, B-before-A independent finish, local persistence, automatic next heat');
