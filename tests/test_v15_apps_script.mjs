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
// 100 heats = 200 distinct starts/finishes. Every two entrants share the start timestamp.
let allStarted=0;
for(let heat=0;heat<100;heat++){
 const numA=heat*2+1,numB=heat*2+2;
 const idA=`run_p_${numA}`,idB=`run_p_${numB}`;
 const targetA='p_'+String(numA).padStart(3,'0'),targetB='p_'+String(numB).padStart(3,'0');
 const startAt=100000+heat*40000;
 const heatName=(heat<75?'M':'F')+String(heat<75?heat+1:heat-74).padStart(3,'0');
 const run=(id,target)=>({id,type:'individual',targetId:target,heatId:heatName,startedAt:startAt,status:'running',deviceId:dev});
 const current={type:'individual',heatId:heatName,runIds:[idA,idB],startedAt:startAt,heartbeatAt:startAt};
 state=request(`pair_start_${heat}`,'mutation',{deviceId:dev,generation:0,patches:{[`runs/${idA}`]:run(idA,targetA),[`runs/${idB}`]:run(idB,targetB),'status/current':current}});
 assert.equal(state.acks[`pair_start_${heat}`].ok,true);
 // both spreadsheet rows marked running immediately (v1.5 fix)
 assert.equal(tabs.get('YC_RESULTS').getRange(numA+1,5).getValue(),'진행 중');
 assert.equal(tabs.get('YC_RESULTS').getRange(numB+1,5).getValue(),'진행 중');
 // B finishes first, A keeps running; for half the heats A finishes first.
 let first=heat%2?idA:idB,second=heat%2?idB:idA;
 const run1={...state.runs[first],status:'finished',elapsedMs:35010+heat,endedAt:startAt+36000};
 state=request(`pair_first_${heat}`,'mutation',{deviceId:dev,generation:0,patches:{[`runs/${first}`]:run1,'status/current':{...current,runIds:[second]}}});
 assert.equal(state.acks[`pair_first_${heat}`].ok,true);
 assert.equal(state.runs[second].status,'running');
 const run2={...state.runs[second],status:'finished',elapsedMs:40500+heat,endedAt:startAt+42000};
 state=request(`pair_second_${heat}`,'mutation',{deviceId:dev,generation:0,patches:{[`runs/${second}`]:run2,'status/current':null}});
 assert.equal(state.acks[`pair_second_${heat}`].ok,true);
 if(heat%12===0)request(`refresh_${heat}`,'claim',{deviceId:dev});
}
assert.equal(Object.values(state.runs).length,200);
assert.equal(tabs.get('YC_RESULTS').getRange(2,3).getValue(),'남자');
assert.equal(tabs.get('YC_RESULTS').getRange(152,3).getValue(),'여자');
assert.equal(tabs.get('YC_RESULTS').getRange(2,5).getValue(),'완료');
const rev=state.meta.revision;
state=request('pair_second_99','mutation',{deviceId:dev,generation:0,patches:{'runs/run_p_200':{status:'finished',elapsedMs:1}}});
assert.equal(state.meta.revision,rev,'same request id cannot overwrite official results');
state=request('reset_individual','reset',{scope:'individual',generation:0});
assert.equal(state.acks.reset_individual.ok,true);
assert.equal(state.meta.generation,1);
assert.equal(Object.values(state.runs).length,0);
state=request('old_generation_retry','mutation',{deviceId:dev,generation:0,patches:{'status/current/heartbeatAt':10}});
assert.equal(state.acks.old_generation_retry.ok,false);
const jsonp=ctx.doGet({parameter:{action:'state',event:'yeoncheon-physical-2026',callback:'__yc_callback_100_1'}});
assert.match(jsonp.text,/^__yc_callback_100_1\(/);
assert.equal(jsonp.mime,'JAVASCRIPT');
console.log('PASS Apps Script mocked 100 paired starts + 200 independent finishes, sheet rows, duplicate IDs, selective reset, stale-generation guard, JSONP');
