// Apps Script Code.gs executed with in-memory Google Sheets mocks.
// This is NOT a real Google deployment test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8');
const values=new Map();
function sheet(name){
 if(!values.has(name))values.set(name,new Map());
 const cells=values.get(name);
 const range=(r,c,n=1,m=1)=>({
   getValue:()=>cells.get(`${r}:${c}`)||'',
   setValue:v=>{cells.set(`${r}:${c}`,v);},
   getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>cells.get(`${r+i}:${c+j}`)||'')),
   setValues:rows=>{rows.forEach((row,i)=>row.forEach((v,j)=>cells.set(`${r+i}:${c+j}`,v)));},
   clearContent:()=>{for(let i=0;i<n;i++)for(let j=0;j<m;j++)cells.delete(`${r+i}:${c+j}`);}
 });
 return {getRange:range,setFrozenRows:()=>{}};
}
const tabs=new Map();
const ss={getSheetByName:n=>tabs.get(n)||null,insertSheet:n=>{const s=sheet(n);tabs.set(n,s);return s;},getUrl:()=> 'https://docs.google.com/spreadsheets/test'};
const getLock=()=>({waitLock:()=>{},releaseLock:()=>{}});
let counter=0;
const ctx=vm.createContext({
 console,Logger:{log:()=>{}},JSON,String,Number,Object,Array,Error,Date,Math,
 SpreadsheetApp:{getActiveSpreadsheet:()=>ss,flush:()=>{}},
 LockService:{getScriptLock:getLock},
 Utilities:{getUuid:()=>`0000-00${++counter}-0000`},
 ContentService:{MimeType:{JSON:'JSON',JAVASCRIPT:'JAVASCRIPT'},createTextOutput:text=>({text,setMimeType(m){this.mime=m;return this;}})}
});
vm.runInContext(src,ctx);
assert.match(ctx.setup(),/READY/);
const get=()=>JSON.parse(ctx.doGet({parameter:{action:'state',event:'yeoncheon-physical-2026'}}).text);
assert.equal(get().data.meta.generation,0);
const request=(id,command,other={})=>{
 const e={parameter:{payload:JSON.stringify({id,command,event:'yeoncheon-physical-2026',...other})}};
 assert.equal(JSON.parse(ctx.doPost(e).text).ok,true);
 return get().data;
};
const dev='mock_device_001';
let state=request('claim_request_001','claim',{deviceId:dev});
assert.equal(state.acks.claim_request_001.result.claimed,true);
assert.equal(request('claim_request_002','claim',{deviceId:'other_device'}).acks.claim_request_002.result.claimed,false);
for(let i=1;i<=200;i++){
  const bib=String(i).padStart(3,'0'),id=`run_${i}`;
  state=request(`start_${i}_test`,'mutation',{deviceId:dev,generation:0,patches:{[`runs/${id}`]:{id,type:'individual',targetId:'p_'+bib,status:'running',startedAt:1000+i,deviceId:dev},'status/current':{runId:id,type:'individual',targetId:'p_'+bib,startedAt:1000+i}}});
  assert.equal(state.acks[`start_${i}_test`].ok,true);
  state=request(`finish_${i}_test`,'mutation',{deviceId:dev,generation:0,patches:{[`runs/${id}`]:{id,type:'individual',targetId:'p_'+bib,status:'finished',elapsedMs:40000+i,deviceId:dev},'status/current':null}});
  assert.equal(state.acks[`finish_${i}_test`].ok,true);
  if(i%15===0)request(`claim_refresh_${i}`,'claim',{deviceId:dev});
}
assert.equal(Object.values(state.runs).length,200);
for(let i=1;i<=50;i++){
 const bib=String(i).padStart(2,'0'),id=`run_relay_${i}`;
 state=request(`relay_start_${i}`,'mutation',{deviceId:dev,generation:0,patches:{[`runs/${id}`]:{id,type:'relay',targetId:'t_'+bib,status:'running',deviceId:dev},'status/current':{runId:id,type:'relay',targetId:'t_'+bib}}});
 assert.equal(state.acks[`relay_start_${i}`].ok,true);
 state=request(`relay_finish_${i}`,'mutation',{deviceId:dev,generation:0,patches:{[`runs/${id}`]:{id,type:'relay',targetId:'t_'+bib,status:'finished',elapsedMs:95000+i,deviceId:dev},'status/current':null}});
 assert.equal(state.acks[`relay_finish_${i}`].ok,true);
}
assert.equal(Object.keys(state.runs).length,250);
assert.equal(tabs.get('YC_RESULTS').getRange(251,1).getValue(),'단체전');
assert.equal(tabs.get('YC_RESULTS').getRange(2,4).getValue(),'완료');
const beforeRevision=state.meta.revision;
state=request('relay_finish_50','mutation',{deviceId:dev,generation:0,patches:{'runs/run_relay_50':{status:'finished',elapsedMs:1}}});
assert.equal(state.meta.revision,beforeRevision,'duplicate request id cannot overwrite official elapsed time');
state=request('reset_individual','reset',{scope:'individual',generation:0});
assert.equal(state.acks.reset_individual.ok,true);
assert.equal(state.meta.generation,1);
assert.equal(Object.values(state.runs).length,50);
state=request('old_generation_retry','mutation',{deviceId:dev,generation:0,patches:{'status/current/heartbeatAt':10}});
assert.equal(state.acks.old_generation_retry.ok,false);
state=request('reset_all','reset',{scope:'all',generation:1});
assert.equal(state.acks.reset_all.ok,true);
assert.equal(state.meta.generation,2);
assert.equal(Object.keys(state.runs).length,0);
assert.equal(tabs.get('YC_RESULTS').getRange(2,4).getValue(),'대기');
const jsonp=ctx.doGet({parameter:{action:'state',event:'yeoncheon-physical-2026',callback:'__yc_callback_100_1'}});
assert.match(jsonp.text,/^__yc_callback_100_1\(/);
assert.equal(jsonp.mime,'JAVASCRIPT');
console.log('PASS Apps Script mock 200 personal + 50 relay = 500 writes, idempotency, claim collision, selective/full reset, stale generation, JSONP');
