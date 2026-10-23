import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyData,presetData,applyPatches,rankings} from '../js/core.js';
import {heatsFor,heatState,progress,startingPatches,finishingPatches,lastRuns} from '../js/heat.js';
const mk=()=>presetData(emptyData());
let idCounter=0;
function start(data,h,tm){const u=startingPatches({data,heat:h,deviceId:'one-device-000001',startedAt:tm,idFactory:()=>String(++idCounter).padStart(12,'0')});applyPatches(data,u.patches);return u.ids;}
function finish(data,id,ms,tm){applyPatches(data,finishingPatches(data,id,{endedAt:tm,elapsedMs:ms}));}

test('75 male heats, 25 female heats, two different bibs each',()=>{
 const males=heatsFor('male'),females=heatsFor('female');
 assert.equal(males.length,75);assert.equal(females.length,25);
 assert.deepEqual(males[0].bibs,[1,2]);assert.deepEqual(males[74].bibs,[149,150]);
 assert.deepEqual(females[0].bibs,[151,152]);assert.deepEqual(females[24].bibs,[199,200]);
 assert.equal(new Set([...males,...females].flatMap(h=>h.ids)).size,200);
});
test('two start together, A completes while B keeps running, independent elapsed',()=>{
 let d=mk(),h=heatsFor('male')[0];const ids=start(d,h,10000);
 assert.equal(d.runs[ids[0]].startedAt,d.runs[ids[1]].startedAt);
 assert.equal(d.status.current.runIds.length,2);
 finish(d,ids[0],36127,46300);
 assert.equal(d.runs[ids[0]].elapsedMs,36130);assert.equal(d.runs[ids[1]].status,'running');
 assert.deepEqual(d.status.current.runIds,[ids[1]]);
 finish(d,ids[1],40498,51000);
 assert.equal(Boolean(d.status.current),false);assert.equal(d.runs[ids[1]].elapsedMs,40500);
 assert.deepEqual(rankings(d,'individual').map(x=>x.bib),['001','002']);
 assert.equal(progress(d,'male').completed,2);
});
test('B may finish before A',()=>{let d=mk(),h=heatsFor('female')[3],ids=start(d,h,20000);finish(d,ids[1],17000,37000);assert.equal(d.runs[ids[0]].status,'running');finish(d,ids[0],28000,48000);assert.equal(Boolean(d.status.current),false);assert.equal(progress(d,'female').completed,2);});
test('prevents starting another heat while previous is running, prevents duplicate',()=>{let d=mk(),h=heatsFor('male')[0],ids=start(d,h,1000);assert.throws(()=>start(d,heatsFor('male')[1],2000));finish(d,ids[0],1000,2000);finish(d,ids[1],2000,3000);assert.throws(()=>start(d,h,5000));});
test('one participant DNF and the other finisher',()=>{let d=mk(),h=heatsFor('female')[0],ids=start(d,h,100);applyPatches(d,finishingPatches(d,ids[0],{endedAt:5000,elapsedMs:null,status:'dnf'}));finish(d,ids[1],6060,6100);assert.equal(progress(d,'female').completed,2);assert.deepEqual(rankings(d,'individual','female').map(x=>x.bib),['152']);});
test('200 individual times, 100 heats and male/female ranks separated',()=>{let d=mk(),tm=10000;for(const h of [...heatsFor('male'),...heatsFor('female')]){const ids=start(d,h,tm);finish(d,ids[0],22220+h.index,tm+25000);finish(d,ids[1],24440+h.index,tm+28000);tm+=31000;}assert.equal(Object.keys(d.runs).length,200);assert.equal(progress(d,'male').completed,150);assert.equal(progress(d,'female').completed,50);assert.equal(rankings(d,'individual','male').length,150);assert.equal(rankings(d,'individual','female').length,50);assert.equal(heatState(d,heatsFor('male')[74]).completed,true);});
