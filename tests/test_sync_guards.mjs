// Simulated cloud integration: verifies application behavior, NOT Firebase network.
// node --experimental-vm-modules tests/test_sync_guards.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const handlers={},app={addEventListener:(k,v)=>handlers[k]=v,innerHTML:''};
let data=null,items=[],callbacks,connected=false,server={},id=0;
const storage={loadLocal:async()=>({data,queue:[...items]}),saveSnapshot:async x=>{data=structuredClone(x)},persistChange:async(x,item)=>{data=structuredClone(x);if(item)items.push(item)},removeOutbox:async id=>{items=items.filter(x=>x.id!==id)},clearAll:async()=>{data=null;items=[]},clearOutbox:async()=>{items=[]}};
const patch=(obj,d)=>{for(const [key,value] of Object.entries(d)){const bits=key.split('/');let dst=obj;for(const bit of bits.slice(0,-1))dst=dst[bit]??={};if(value===null)delete dst[bits.at(-1)];else dst[bits.at(-1)]=structuredClone(value);}};
const cloud={
 isConfigured:()=>true,
 createCloud:async cb=>{
  callbacks=cb;
  queueMicrotask(()=>{cb.onReady({uid:'anonymous-id'});cb.onConnected(true);cb.onData(server);connected=true});
  return {send:async(p,generation)=>{if(generation!==(server.meta?.generation||0))throw Error('reset generation changed');if(!connected)throw Error('network offline');patch(server,p);queueMicrotask(()=>callbacks.onData(server))},claim:async()=>true,release:async()=>{},reset:async()=>({})}
 }
};
const document={querySelector:s=>s==='#app'?app:null,getElementById:()=>null,activeElement:{tagName:'BODY'}};
const context=vm.createContext({document,window:{addEventListener:(n,f)=>handlers[`window_${n}`]=f},location:{search:''},URLSearchParams,URL,console,Date,JSON,Math,Number,String,Object,Array,Boolean,Error,Promise,Map,Set,Blob,performance:{now:()=>id++*501.6},sessionStorage:{getItem:()=>null,setItem:()=>{}},globalThis:{crypto:{randomUUID:()=>`00000000-0000-0000-0000-${String(++id).padStart(12,'0')}`}},setInterval:()=>0,setTimeout:()=>0,confirm:()=>true,structuredClone});
const modules=new Map();
const load=f=>{
 if(modules.has(f))return modules.get(f);
 let m;
 if(f==='js/storage.js'||f==='js/cloud.js'){
  const ex=f==='js/storage.js'?storage:cloud;
  m=new vm.SyntheticModule(Object.keys(ex),function(){for(const [k,v]of Object.entries(ex))this.setExport(k,v)},{context});
 }else m=new vm.SourceTextModule(fs.readFileSync(path.join(root,f),'utf8'),{context,identifier:f});
 modules.set(f,m);return m;
};
const main=load('js/app.js');await main.link(async(spec,parent)=>load(path.posix.normalize(path.posix.join(path.posix.dirname(parent.identifier),spec))));await main.evaluate();
const idle=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r))};
const click=async action=>handlers.click({target:{closest:s=>s==='[data-action]'?{dataset:{action}}:null}});
await idle();assert.match(app.innerHTML,/서버 동기화 정상/);
await click('start');assert.equal(Object.keys(data?.runs||{}).length,0,'start requires claim');
await click('claim');await click('start');await idle();
assert.equal(Object.keys(data.runs).length,1);assert.equal(items.length,0,'server ACK empties queue');
connected=false;callbacks.onConnected(false);
await click('finish');await idle();
assert.equal(items.length,1,'offline finish persists locally to outbox');assert.equal(Object.values(data.runs)[0].status,'finished');
await click('start');assert.equal(Object.keys(data.runs).length,1,'offline next start must be denied');
connected=true;callbacks.onConnected(true);await idle();assert.equal(items.length,0,'reconnected queue successfully sent');
await click('start');assert.equal(Object.keys(data.runs).length,2,'online next start succeeds after sync');
console.log('PASS simulated online/start, connection loss/offline finish and pending queue, offline-start guard, reconnect flush');
