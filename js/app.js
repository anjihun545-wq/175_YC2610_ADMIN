import {APPS_SCRIPT_URL,EVENT_ID} from './apps-script-config.js';
import {loadLocal,saveSnapshot,persistChange,removeOutbox,clearAll,clearOutbox} from './storage.js';
import {emptyData,presetData,uid,safe,msText,tsText,deepCopy,applyPatches,rankings,csvDownload,statusLabel} from './core.js';
import {heatsFor,heatState,lastRuns,progress,startingPatches,finishingPatches,DIVISIONS,pad} from './heat.js';
import {isConfigured,createCloud} from './cloud.js';

const p=new URLSearchParams(location.search);
const deviceId=(()=>{let k;try{k=sessionStorage.getItem('yc2026-timer-tab');if(!k){k=uid();sessionStorage.setItem('yc2026-timer-tab',k);}return k;}catch{return uid();}})();
const S={configured:isConfigured(),cloud:null,connected:false,loaded:false,storageReady:false,mode:isConfigured()?'cloud':'local',data:presetData(emptyData()),outbox:[],sending:false,control:false,claiming:false,mutating:false,resetting:false,tab:p.get('view')==='mc'?'mc':'timer',readOnly:p.get('view')==='mc',division:'male',heatIndex:0,clock:null,relay:{state:'idle',started:0,elapsed:0,perf:0},offset:0,error:'',modal:null,editId:'',backup:false};
const root=document.getElementById('app');let finishQueue=Promise.resolve();const pendingFinishes=new Set();
const cloudGen=()=>Number(S.data.meta?.generation||0);
const active=()=>S.data.status?.current?.runIds?.length?S.data.status.current:null;
const chosenHeat=()=>heatsFor(S.division)[S.heatIndex];
const activeRunFor=target=>Object.values(S.data.runs).find(r=>r.type==='individual'&&r.targetId===target&&r.status==='running');
const myClockRun=(run)=>S.clock?.ids?.includes(run.id)&&S.clock.startedAt===run.startedAt;
const elapsed=(run)=>myClockRun(run)?Math.max(0,performance.now()-S.clock.perf):Math.max(0,Date.now()+S.offset-run.startedAt);
const errText=e=>e?.message||String(e);
function notify(msg,error=false){const box=document.querySelector('.toast-stack');if(!box)return;const el=document.createElement('div');el.className='toast '+(error?'error':'good');el.textContent=msg;box.appendChild(el);setTimeout(()=>el.remove(),5600);}
function serverLabel(){if(!S.storageReady)return ['기기 저장 오류','bad'];if(S.mode==='local')return ['서버 미설정 · 기기 저장','warn'];if(!S.connected)return ['서버 연결 끊김','bad'];if(!S.loaded)return ['서버 기록 확인 중','warn'];if(S.outbox.length)return [`미전송 ${S.outbox.length}건`,'warn'];return ['서버 저장 확인 정상','ok'];}
function pendingOnline(){return S.configured&&(!S.connected||!S.loaded||S.outbox.length>0);}
function isAllowedToStart(){return !S.readOnly&&S.storageReady&&S.control&&!S.data.status?.current&&!S.mutating&&!S.resetting&&!pendingOnline();}
function isAllowedToFinish(){return !S.readOnly&&S.storageReady&&!S.resetting&&(S.control||Boolean(active()?.runIds?.some(id=>S.data.runs[id]?.deviceId===deviceId)));}
async function commit(patches,activity){
 if(S.readOnly)throw Error('MC 조회 화면에서는 기록을 변경할 수 없습니다.');
 const next=presetData(applyPatches(deepCopy(S.data),patches));
 const task=S.configured?{id:uid(),patches,createdAt:Date.now(),activity,generation:cloudGen()}:null;
 await persistChange(next,task);S.data=next;if(task)S.outbox.push(task);render();if(task)void flush();
}
async function flush(){
 if(!S.cloud||!S.connected||!S.loaded||S.sending||S.resetting||S.readOnly)return;
 S.sending=true;
 try{while(S.outbox.length&&S.connected){const x=S.outbox[0];try{
  if(x.generation!==cloudGen())throw Error('초기화 이전 기록이 남아 있습니다. 자동 전송을 중단했습니다.');
  await S.cloud.send(x.patches,x.generation,x.id,deviceId);
  await removeOutbox(x.id);S.outbox.shift();refreshConnection();
 }catch(e){S.error=errText(e);notify('서버 저장 지연: 기기에 기록을 보관했습니다.',true);break;}}
 }finally{S.sending=false;refreshConnection();}
}
function remoteData(remote){
 let result={...emptyData(),...(remote||{})};
 for(const x of S.outbox){if(x.generation===Number(result.meta?.generation||0))result=applyPatches(result,x.patches);else S.error='초기화 전 미전송 기록이 있습니다. 백업하고 확인하세요.';}
 S.data=presetData(result);S.loaded=true;syncActiveHeat();
 void saveSnapshot(result).catch(e=>notify('기기 백업 실패: '+errText(e),true));
 render();void flush();
}
async function boot(){
 try{const l=await loadLocal();S.data=presetData(l.data||emptyData());syncActiveHeat();S.outbox=(l.queue||[]).sort((a,b)=>a.createdAt-b.createdAt);S.storageReady=true;}
 catch(e){S.error=errText(e);}
 if(!S.configured){S.mode='local';S.control=true;render();return;}
 render();try{S.cloud=await createCloud({onReady:()=>render(),onData:remoteData,onConnected:v=>{S.connected=v;refreshConnection();if(v)void flush();else render();},onServerOffset:v=>{S.offset=v;},onError:e=>{S.error=errText(e);refreshConnection();}});}catch(e){S.error=errText(e);render();}
}
function header(){let [label,cls]=serverLabel();return `<header class="topbar"><div class="brand"><div class="brand-icon">Y26</div><div><div class="brand-kicker">YEONCHEON PHYSICAL SURVIVAL</div><h1>2026 연천피지컬 서바이벌</h1></div></div><div class="header-right"><span class="status-pill ${cls}" id="connection-pill">${safe(label)}</span><span class="status-pill">${S.readOnly?'MC 조회':S.mode==='local'?'기기 전용':'공용 계측'}</span></div></header>`;}
function refreshConnection(){const el=document.getElementById('connection-pill');if(el){let [t,c]=serverLabel();el.textContent=t;el.className='status-pill '+c;}const q=document.querySelector('#queue-count');if(q)q.textContent=String(S.outbox.length);}
function nav(){return `<nav class="nav">${(S.readOnly?[['mc','MC 순위']]:[['timer','개인전 계측'],['relay','계주 스톱워치'],['slots','번호별 현황'],['dashboard','운영 현황'],['rank','기록·순위'],['mc','MC 화면'],['settings','운영·백업']]).map(([id,l])=>`<button data-tab="${id}" class="${S.tab===id?'active':''}">${l}</button>`).join('')}</nav>`;}
function heading(k,title,detail=''){return `<div class="view-heading"><div><div class="overline">${k}</div><h2>${title}</h2><div class="muted small">${detail}</div></div></div>`;}
function controlBox(){if(S.mode==='local')return `<div class="info-strip">현재 기기에만 기록됩니다. 서버 기록 공유는 Apps Script 연결 후 사용할 수 있습니다.</div>`;
 return S.control?`<div class="info-strip success">이 기기가 공식 계측 제어권을 갖고 있습니다. ${S.connected?'서버 연결됨':'현재 서버 연결 끊김'}.</div><button class="btn ghost" data-action="release" ${active()?'disabled':''}>제어권 반납</button>`:`<div class="info-strip danger">경기 시작 전 계측 제어권이 필요합니다. 한 대의 기기에서만 출발·종료를 조작하세요.</div><button class="btn primary section-gap" data-action="claim" ${!S.connected||!S.loaded||S.claiming?'disabled':''}>계측 제어권 획득</button>`;}
function syncActiveHeat(){const current=active();if(!current?.heatId)return;const division=current.heatId.startsWith('F')?'female':'male',index=Number(current.heatId.slice(1))-1;if(index>=0&&index<heatsFor(division).length){S.division=division;S.heatIndex=index;}}
function heatInfo(){const h=chosenHeat(),hs=heatState(S.data,h),cur=active();return {h,hs,cur};}
function timerView(){const {h,hs,cur}=heatInfo();const hsall=heatsFor(S.division),pr=progress(S.data,S.division),curHeat=cur?.heatId===h.id;
 const disabled=!!S.data.status?.current||S.mutating;
 const options=hsall.map(x=>`<option value="${x.index}" ${x.index===S.heatIndex?'selected':''}>${x.id}조 · ${pad(x.bibs[0])} / ${pad(x.bibs[1])}</option>`).join('');
 const cards=h.ids.map((id,i)=>{const r=hs.items[i],live=r?.status==='running'&&cur?.runIds?.includes(r.id),pending=pendingFinishes.has(r?.id),seconds=live?elapsed(r):r?.elapsedMs;
 return `<div class="lane-card ${live?'lane-live':''}"><div class="lane-head"><b>${i?'B':'A'} 레인 · ${safe(h.bibs[i])}번</b><span class="chip ${live?'warn':r?.status==='finished'?'good':''}">${live?'진행 중':statusLabel(r)}</span></div><div class="lane-time" id="lane-time-${i}">${r?.status==='finished'?msText(seconds):live?msText(seconds):r&&['dnf','dsq'].includes(r.status)?'—':'00:00.00'}</div><button class="action-btn stop" data-action="finish-lane" data-target="${id}" ${!live||pending||!isAllowedToFinish()?'disabled':''}>■ ${i?'B':'A'} 종료</button><div class="lane-sub"><button class="btn sm" data-action="lane-dnf" data-target="${id}" ${!live||pending?'disabled':''}>미완주</button><button class="btn sm" data-action="lane-dsq" data-target="${id}" ${!live||pending?'disabled':''}>실격</button></div></div>`;}).join('');
 return `${heading('RACE CONTROL','개인전 · 2인 동시 출발','같은 출발 버튼 1개 · A/B 각각 종료 · 남자 150명 / 여자 50명')}
 ${S.mode==='local'?'<div class="banner">서버 미설정: 이 기기에만 기록됩니다.</div>':''}${S.data.status?.current&&!S.data.status.current.runIds?'<div class="banner red">이전 버전에서 진행 중인 경기 데이터가 있습니다. v1.4에서 경기를 종료하거나 기록을 백업한 뒤 운영본부에서 정리해야 합니다.</div>':''}
 <div class="layout-two"><section class="panel"><div class="panel-head"><h3>개인전 기록 계측</h3><span class="chip">${pr.completed} / ${pr.total} 완료</span></div>
 <div class="fields"><div class="field"><label for="division">부문</label><select id="division" ${disabled?'disabled':''}><option value="male" ${S.division==='male'?'selected':''}>남자 개인전 · 001~150</option><option value="female" ${S.division==='female'?'selected':''}>여자 개인전 · 151~200</option></select></div><div class="field"><label for="heat">출발 조</label><select id="heat" ${disabled?'disabled':''}>${options}</select></div></div>
 <div class="count-progress"><span>${safe(DIVISIONS[S.division].label)}</span><div class="progress-rail"><div style="width:${100*pr.completed/pr.total}%"></div></div><b>${pr.completed} / ${pr.total}</b></div>
 <div class="timer-face ${cur?'running':''}"><div class="overline">${h.id} · 두 선수 공통 출발</div><div class="time" id="live-clock">${curHeat?msText(Math.max(0,Date.now()+S.offset-cur.startedAt)):'00:00.00'}</div><div class="timer-status">${curHeat?'진행 중 · A/B 종료 독립':'출발 대기'}</div></div>
 <button class="action-btn start full-action" data-action="start-heat" ${!isAllowedToStart()||!hs.available?'disabled':''}>▶ ${h.id} 두 선수 동시 시작</button>
 <div class="lane-grid">${cards}</div><p class="notice-line">단축키: <b>Space</b> 함께 시작 · <b>1</b> A 종료 · <b>2</b> B 종료. 결승선을 통과하는 순간 각자 따로 누르세요.</p>
 </section><aside class="stack"><section class="panel"><h3>계측 제어권</h3><div class="section-gap">${controlBox()}</div>${S.error?`<div class="banner red">${safe(S.error)}</div>`:''}</section><section class="panel"><h3>운영 순서</h3><p class="notice-line">① 남자부 또는 여자부를 고릅니다.<br>② 두 번호를 확인하고 함께 출발시킵니다.<br>③ 첫 주자가 들어오면 해당 레인 종료.<br>④ 나머지 주자가 들어오면 다른 레인 종료.<br>⑤ 두 명 모두 완료되면 다음 조로 이동합니다.</p></section></aside></div>`;
}
function relayView(){const r=S.relay;let time=r.state==='running'?r.elapsed+Math.max(0,performance.now()-r.perf):r.elapsed;
return `${heading('RELAY STOPWATCH','계주 · 스톱워치','4인 1팀, 순차 출발 · 팀번호 및 기록 서버 저장 없음')}
<section class="panel relay-panel"><p class="muted small">첫 주자가 출발하면 시작, 마지막 주자가 도착하면 정지하세요. 이 화면은 개인전 기록과 독립되어 있습니다.</p>
<div class="timer-face ${r.state==='running'?'running':''}"><div class="overline">RELAY · SIMPLE STOPWATCH</div><div class="time" id="relay-clock">${msText(time)}</div><div class="timer-status">${r.state==='running'?'계측 중':r.state==='stopped'?'정지':'대기'}</div></div>
<div class="relay-controls"><button class="action-btn start" data-action="relay-start" ${r.state==='running'?'disabled':''}>▶ ${r.state==='stopped'?'이어 재기':'시작'}</button><button class="action-btn stop" data-action="relay-stop" ${r.state!=='running'?'disabled':''}>■ 정지</button><button class="btn reset-relay" data-action="relay-reset" ${r.state==='running'?'disabled':''}>↻ 초기화</button></div>
<div class="info-strip section-gap">계주 스톱워치 결과는 서버에 기록되지 않습니다. 필요하면 정지된 시간을 별도로 적어두세요. 새로고침하면 스톱워치는 초기화됩니다.</div></section>`;}
function slotsView(){const last=lastRuns(S.data),p=progress(S.data,S.division);return `${heading('BIB BOARD','번호별 현황','2명씩 출발 · 완료 / 대기 현황')}
<section class="panel"><div class="fields"><div class="field"><label>부문 선택</label><select id="division"><option value="male" ${S.division==='male'?'selected':''}>남자 개인전</option><option value="female" ${S.division==='female'?'selected':''}>여자 개인전</option></select></div><div class="count-inline">완료 ${p.completed} / ${p.total}</div></div><div class="slot-grid section-gap">${heatsFor(S.division).flatMap(h=>h.ids.map((id,i)=>{const r=last[id];return `<button class="slot-tile ${r?.status==='finished'?'done':r&&['dnf','dsq'].includes(r.status)?'other':''}" data-action="select-heat" data-heat="${h.index}" ${active()?'disabled':''}><b>${pad(h.bibs[i])}</b><span>${r?.status==='finished'?msText(r.elapsedMs):statusLabel(r)}</span></button>`;})).join('')}</div></section>`;}
function dashboard(){const pm=progress(S.data,'male'),pf=progress(S.data,'female'),cur=active();return `${heading('OPERATIONS','경기 운영 현황','남자 150명 / 여자 50명 · 2인 1조 · 총 100조')}
<div class="cards"><div class="metric"><label>남자 개인전</label><strong>${pm.completed}</strong><small>/ 150명</small></div><div class="metric"><label>여자 개인전</label><strong>${pf.completed}</strong><small>/ 50명</small></div><div class="metric"><label>대기 인원</label><strong>${pm.waiting+pf.waiting}</strong><small>명</small></div><div class="metric"><label>서버 미전송</label><strong>${S.outbox.length}</strong><small>건</small></div></div>
<section class="panel"><h3>현재 경기</h3><div class="timer-face"><div class="overline">${cur?.heatId||'대기'}</div><div class="time" id="live-clock">${cur?msText(Math.max(0,Date.now()+S.offset-cur.startedAt)):'00:00.00'}</div></div><p class="notice-line">계주는 팀번호 관리 없이 별도의 스톱워치만 사용합니다.</p></section>`;}
function ranked(division){return rankings(S.data,'individual').filter(x=>x.division===division);}
function rankRows(division,limit){
 const rows=ranked(division),all=Object.values(S.data.participants).filter(x=>x.division===division),last=lastRuns(S.data);
 const finished=rows.slice(0,limit).map((x,i)=>`<tr><td>${1+rows.findIndex(y=>y.run.elapsedMs===x.run.elapsedMs)}</td><td><b>${safe(x.bib)}번</b></td><td><b>${msText(x.run.elapsedMs)}</b></td><td>${x.run.verified?'확정':'잠정'}</td>${S.readOnly?'':`<td><button class="btn sm" data-action="edit" data-id="${x.run.id}">수정</button><button class="btn sm" data-action="verify" data-id="${x.run.id}" ${x.run.verified?'disabled':''}>확정</button></td>`}</tr>`).join('');
 const nonFinish=all.filter(x=>['dnf','dsq'].includes(last[x.id]?.status)).map(x=>`<tr><td>—</td><td>${safe(x.bib)}번</td><td>—</td><td>${statusLabel(last[x.id])}</td>${S.readOnly?'':`<td><button class="btn sm" data-action="edit" data-id="${last[x.id].id}">수정</button></td>`}</tr>`).join('');
 return finished+nonFinish||'<tr><td colspan="5">아직 기록 없음</td></tr>';
}
function rankView(){return `${heading('RESULTS','개인전 기록 · 순위','남녀 각각 기록시간 오름차순 · 완료 후 잠정 순위에 반영')}
${['male','female'].map(d=>`<section class="panel section-gap"><div class="panel-head"><h3>${DIVISIONS[d].label}</h3><button class="btn sm" data-action="csv-${d}">CSV 다운로드</button></div><div class="table-wrap"><table><thead><tr><th>순위</th><th>번호</th><th>시간</th><th>판정</th>${S.readOnly?'':'<th>관리</th>'}</tr></thead><tbody>${rankRows(d,150)}</tbody></table></div></section>`).join('')}`;}
function mcView(){const cur=active();const men=ranked('male').slice(0,10),women=ranked('female').slice(0,10);return `${heading('LIVE RESULTS','MC 실시간 기록 조회','Apps Script 약 5초 간격 조회 · 잠정 기록 / 확정 기록 구분')}
${S.mode!=='local'&&!S.connected?'<div class="banner red">서버 연결이 끊겨 최신 정보가 아닐 수 있습니다.</div>':''}
<div class="mc-clock"><div class="overline">${cur?safe(cur.heatId)+'조 · 동시 출발':'NEXT HEAT'}</div><h2>${cur?'개인전 계측 진행 중':'경기 대기 중'}</h2><div class="time" id="live-clock">${cur?msText(Math.max(0,Date.now()+S.offset-cur.startedAt)):'00:00.00'}</div><div class="notice-line">표시 시간은 참고용이며 공식 기록은 개별 선수 종료 시 측정한 값입니다.</div></div>
<div class="mc-grid two section-gap">${[[men,'남자 개인전 TOP 10'],[women,'여자 개인전 TOP 10']].map(([data,label])=>`<section class="panel"><h3>${label}</h3><div class="stack section-gap">${data.length?data.map((x,i)=>`<div class="list-item"><div><strong>${i+1}위 · ${safe(x.bib)}번</strong></div><div><b>${msText(x.run.elapsedMs)}</b><div class="tiny muted">${x.run.verified?'확정':'잠정'}</div></div></div>`).join(''):'<div class="empty">기록 대기 중</div>'}</div></section>`).join('')}</div>`;}
function jsonBackup(){const blob=new Blob([JSON.stringify({eventId:EVENT_ID,exportedAt:new Date().toISOString(),data:S.data,pendingOutbox:S.outbox},null,2)],{type:'application/json'});const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='2026_연천피지컬_전체백업.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),3000);S.backup=true;notify('JSON 백업을 요청했습니다. 다운로드 파일을 확인하세요.');}
function csvExport(division=null){const people=Object.values(S.data.participants).filter(x=>!division||x.division===division);const last=lastRuns(S.data);const rows=people.map(x=>{const r=last[x.id];return [x.division==='male'?'남자':'여자',x.bib,r?.elapsedMs!=null?(r.elapsedMs/1000).toFixed(2):'',statusLabel(r),r?.verified?'확정':'잠정',tsText(r?.startedAt),tsText(r?.endedAt)];});csvDownload(`2026_연천개인전_${division||'전체'}_${new Date().toISOString().slice(0,10)}.csv`,['부문','번호','초','상태','공식 확정','출발시각','도착시각'],rows);}
function settingsView(){return `${heading('BACKUP & CONTROL','운영·백업','기록 재전송 · 내보내기 · 초기화')}
<div class="layout-two"><section class="panel"><h3>저장 상태</h3><div class="control-card"><span>연결 상태</span><b>${safe(serverLabel()[0])}</b></div><div class="control-card"><span>미전송 기록</span><b id="queue-count">${S.outbox.length}</b></div><div class="tools section-gap"><button class="btn" data-action="retry">서버 재전송</button><button class="btn primary" data-action="csv-all">개인전 전체 CSV</button><button class="btn" data-action="backup">JSON 백업</button></div>${S.error?`<div class="banner red">${safe(S.error)}</div>`:''}</section><section class="panel"><h3>기록 초기화</h3><p class="notice-line">개인전 기록만 또는 전체 기록을 삭제합니다. 이전 버전의 단체전 기록은 전체 초기화 때 함께 지워집니다. 계주의 새로운 스톱워치는 기기 전용으로 초기화합니다.</p><button class="btn" data-action="open-reset" ${active()||S.outbox.length?'disabled':''}>기록 초기화 관리</button><p class="notice-line">로그인 없는 공개 Apps Script 방식은 외부 접근자가 기록을 조작할 수 있습니다. 공개 배포는 권장하지 않습니다.</p></section></div>`;}
function modal(){if(S.modal==='reset')return `<div class="dialog-backdrop"><div class="dialog"><h3>기록 초기화</h3><div class="banner red">저장된 기록이 삭제됩니다. 백업 파일을 확인한 후에 진행하세요.</div><button class="btn primary" data-action="backup">① JSON 전체 백업</button><form id="reset-form" class="stack section-gap"><div class="field"><label>범위</label><select name="scope"><option value="individual">개인전 기록만</option><option value="all">전체 기록 (기존 단체전 기록 포함)</option></select></div><label><input type="checkbox" name="confirmBackup" ${S.backup?'':'disabled'} required> 다운로드한 파일을 확인했습니다</label><div class="field"><label>확인 문구</label><input name="phrase" placeholder="기록초기화" required></div><div class="actions"><button type="button" class="btn" data-action="close-modal">취소</button><button type="submit" class="btn primary" ${S.backup?'':'disabled'}>초기화 실행</button></div></form></div></div>`;
 if(S.modal==='edit'){const r=S.data.runs[S.editId];if(!r)return '';return `<div class="dialog-backdrop"><div class="dialog"><h3>선수 ${safe(r.targetId.slice(2))}번 기록 수정</h3><form id="edit-form" class="stack"><div class="field"><label>판정</label><select name="status"><option value="finished">정상 종료</option><option value="dnf">미완주</option><option value="dsq">실격</option><option value="cancelled">기록 취소·재계측</option></select></div><div class="field"><label>기록 (초)</label><input name="seconds" type="number" step=".01" min="0" max="36000" value="${r.elapsedMs===null||r.elapsedMs===undefined?'':r.elapsedMs/1000}"></div><div class="field"><label>수정 이유</label><textarea name="reason" required></textarea></div><div class="actions"><button class="btn" type="button" data-action="close-modal">닫기</button><button class="btn primary" type="submit">수정 저장</button></div></form></div></div>`;}return '';
}
function render(){const views={timer:timerView,relay:relayView,slots:slotsView,dashboard,rank:rankView,mc:mcView,settings:settingsView};if(S.readOnly&&!['mc','rank'].includes(S.tab))S.tab='mc';root.innerHTML=`<div class="app-shell">${header()}${nav()}<main>${(views[S.tab]||timerView)()}</main><footer class="footer"><span>2026 연천피지컬 서바이벌 · 계측 v1.5</span><span>초기 기록은 잠정이며 심판 확인 후 확정됩니다.</span></footer></div>${modal()}<div class="toast-stack" role="status" aria-live="polite"></div>`;refreshClocks();}
function refreshClocks(){if(S.tab==='timer'){const h=chosenHeat(),cur=active();const el=document.getElementById('live-clock');if(el){el.textContent=cur?.heatId===h.id?msText(Math.max(0,Date.now()+S.offset-cur.startedAt)):'00:00.00';}for(let i=0;i<2;i++){const x=document.getElementById('lane-time-'+i);if(!x)continue;const r=activeRunFor(h.ids[i]);if(r)x.textContent=msText(elapsed(r));}}
 else if(S.tab==='relay'){const x=document.getElementById('relay-clock');if(x)x.textContent=msText(S.relay.state==='running'?S.relay.elapsed+performance.now()-S.relay.perf:S.relay.elapsed);}
 else if(['mc','dashboard'].includes(S.tab)){const x=document.getElementById('live-clock'),cur=active();if(x)x.textContent=cur?msText(Date.now()+S.offset-cur.startedAt):'00:00.00';}}
setInterval(refreshClocks,40);
setInterval(()=>{if(S.outbox.length)void flush();},6500);
setInterval(async()=>{if(!S.cloud||!S.control||!S.connected||S.readOnly)return;try{
 const good=await S.cloud.claim(deviceId);if(!good){S.control=false;notify('제어권이 다른 기기로 이동했습니다.',true);render();return;}
 const cur=active();if(cur&&!S.outbox.length)await S.cloud.send({'status/current/heartbeatAt':Date.now()},cloudGen(),uid(),deviceId);
 }catch(e){S.error=errText(e);refreshConnection();}},20000);
async function claim(){if(S.mode==='local'){S.control=true;render();return;}if(!S.connected||!S.loaded||!S.cloud)return notify('서버 연결을 기다리는 중입니다.',true);S.claiming=true;render();try{S.control=await S.cloud.claim(deviceId);notify(S.control?'계측 제어권 획득':'다른 계측 기기가 사용 중',!S.control);}catch(e){notify(errText(e),true);}finally{S.claiming=false;render();}}
async function release(){if(active())return notify('경기 종료 후 제어권을 반납하세요.',true);if(S.cloud&&S.connected)await S.cloud.release(deviceId);S.control=false;render();}
async function startHeat(){if(!isAllowedToStart())return notify('제어권·서버 동기화·미전송 상태를 확인하세요.',true);
 const h=chosenHeat();if(!heatState(S.data,h).available)return notify('이 조에 이미 기록된 선수가 있습니다.',true);
 S.mutating=true;const perf=performance.now(),at=Date.now();const {patches,ids}=startingPatches({data:S.data,heat:h,deviceId,startedAt:at,idFactory:()=>uid().replaceAll('-','')});S.clock={ids,perf,startedAt:at};
 try{await commit(patches,`2인 동시 출발: ${h.id}`);notify(`${h.id}조 두 명 동시 출발`);}catch(e){S.clock=null;notify('출발 저장 실패: '+errText(e),true);}finally{S.mutating=false;render();}
}
function markFinish(target,status='finished'){
 if(!isAllowedToFinish())return notify('제어권이나 기기 저장소 상태를 확인하세요.',true);
 const r=activeRunFor(target);if(!r||pendingFinishes.has(r.id))return;
 // 버튼이 눌린 순간의 시각을 먼저 캡처. 각 레인의 저장은 순차 처리되어도 기록값에 영향 없음.
 const at=Date.now(),ms=status==='finished'?elapsed(r):null,accuracy=myClockRun(r)?'monotonic':'estimated';
 pendingFinishes.add(r.id);render();
 finishQueue=finishQueue.then(async()=>{
 try{const patch=finishingPatches(S.data,r.id,{endedAt:at,elapsedMs:ms,status,accuracy});await commit(patch,`개인전 ${target} ${status}`);notify(`${target.slice(2)}번 ${status==='finished'?msText(ms):status} 기기 저장됨`);
 if(!active()){S.clock=null;const heats=heatsFor(S.division),n=heats.findIndex((h,i)=>i>S.heatIndex&&heatState(S.data,h).available);if(n>=0)S.heatIndex=n;}}
 catch(e){notify('기록 저장 실패: '+errText(e),true);}finally{pendingFinishes.delete(r.id);render();}
 }).catch(e=>{pendingFinishes.delete(r.id);notify(errText(e),true);});
}
async function updateRun(id,kind,reason='',seconds=''){
 const r=S.data.runs[id];if(!r||r.status==='running')throw Error('진행 중 기록은 수정할 수 없습니다.');
 const next={...r,status:kind,elapsedMs:kind==='finished'?Math.round(Number(seconds)*100)*10:null,verified:false,accuracy:'manual',endedAt:r.endedAt||Date.now(),updatedAt:Date.now()};
 const aid='audit_'+uid().replaceAll('-','');await commit({[`runs/${id}`]:next,[`audit/${aid}`]:{id:aid,action:'개인 기록 수정',detail:`${r.targetId}: ${reason}`,at:Date.now(),actor:'LOCAL'}},'기록 수정');
}
async function verify(id){const r=S.data.runs[id];if(!r||r.status!=='finished')return;if(r.accuracy==='estimated'&&!confirm('브라우저 복구 후 추정 기록입니다. 영상으로 대조했습니까?'))return;
 const aid='audit_'+uid().replaceAll('-','');await commit({[`runs/${id}`]:{...r,verified:true,updatedAt:Date.now()},[`audit/${aid}`]:{id:aid,action:'기록 확정',detail:r.targetId,at:Date.now(),actor:'LOCAL'}},'기록 확정');}
async function resetRecords(form){if(S.readOnly||S.resetting||active()||S.outbox.length||S.sending||pendingFinishes.size||S.mutating)throw Error('진행 중 경기 또는 미전송 데이터가 있습니다.');
 const v=new FormData(form),scope=String(v.get('scope'));
 if(!['individual','all'].includes(scope)||!S.backup||v.get('confirmBackup')!=='on'||String(v.get('phrase')).trim()!=='기록초기화')throw Error('백업과 확인 문구를 검사하세요.');
 if(S.configured&&(!S.connected||!S.loaded))throw Error('서버 연결 확인 후 초기화할 수 있습니다.');if(!confirm(`${scope==='all'?'전체':'개인전'} 기록을 초기화할까요?`))return;
 S.resetting=true;S.modal=null;render();try{let next;
 if(S.configured){next=await S.cloud.reset(scope,cloudGen());await saveSnapshot(presetData({...emptyData(),...next}));}
 else {next=deepCopy(S.data);if(scope==='all'){next.runs={};next.audit={};}else next.runs=Object.fromEntries(Object.entries(next.runs||{}).filter(([,r])=>r.type!=='individual'));next.status={current:null};next.meta={...(next.meta||{}),generation:cloudGen()+1};await clearAll();await saveSnapshot(next);}
 S.data=presetData({...emptyData(),...next});S.control=S.mode==='local';S.clock=null;S.heatIndex=0;S.backup=false;notify('기록 초기화 완료');
 }catch(e){notify('초기화 실패: '+errText(e),true);}finally{S.resetting=false;render();}}
function relayStart(){if(S.relay.state==='running')return;S.relay.perf=performance.now();S.relay.state='running';render();}
function relayStop(){if(S.relay.state!=='running')return;S.relay.elapsed+=performance.now()-S.relay.perf;S.relay.state='stopped';render();}
function relayReset(){if(S.relay.state==='running')return;S.relay={state:'idle',started:0,elapsed:0,perf:0};render();}
root.addEventListener('click',e=>{const tab=e.target.closest('[data-tab]');if(tab){if(active()&&tab.dataset.tab!=='timer'){notify('개인전 계측 중입니다. 두 선수의 기록이 모두 종료된 후 메뉴를 이동하세요.',true);return;}S.tab=tab.dataset.tab;render();return;}const el=e.target.closest('[data-action]');if(!el)return;const action=el.dataset.action;
 const run=async()=>{switch(action){case 'claim':return claim();case 'release':return release();case 'start-heat':return startHeat();case 'finish-lane':return markFinish(el.dataset.target);case 'lane-dnf':return confirm('해당 선수를 미완주 처리할까요?')?markFinish(el.dataset.target,'dnf'):null;case 'lane-dsq':return confirm('해당 선수를 실격 처리할까요?')?markFinish(el.dataset.target,'dsq'):null;
 case 'relay-start':return relayStart();case 'relay-stop':return relayStop();case 'relay-reset':return relayReset();case 'select-heat':if(active())return;S.heatIndex=Number(el.dataset.heat);S.tab='timer';return render();case 'edit':S.editId=el.dataset.id;S.modal='edit';return render();case 'verify':return verify(el.dataset.id);case 'csv-all':return csvExport();case 'csv-male':return csvExport('male');case 'csv-female':return csvExport('female');case 'backup':return jsonBackup();case 'retry':return flush();case 'open-reset':S.modal='reset';S.backup=false;return render();case 'close-modal':S.modal=null;return render();}}
 Promise.resolve().then(run).catch(ex=>notify(errText(ex),true));
});
root.addEventListener('change',e=>{const el=e.target;if(el.id==='division'&&!active()){S.division=el.value;S.heatIndex=0;render();}else if(el.id==='heat'&&!active()){S.heatIndex=Number(el.value);render();}});
root.addEventListener('submit',e=>{e.preventDefault();const form=e.target;Promise.resolve().then(async()=>{const v=new FormData(form);
 if(form.id==='reset-form')return resetRecords(form);
 if(form.id==='edit-form'){
  const status=String(v.get('status')),reason=String(v.get('reason')).trim(),seconds=String(v.get('seconds')).trim();if(!reason)throw Error('수정 이유를 입력하세요.');
  if(status==='finished'&&(!seconds||!Number.isFinite(Number(seconds))||Number(seconds)<0||Number(seconds)>36000))throw Error('유효한 초 단위 시간을 입력하세요.');
  await updateRun(S.editId,status,reason,seconds);S.modal=null;render();notify('수정 완료');
 }
 }).catch(x=>notify(errText(x),true));});
window.addEventListener('keydown',e=>{if(S.tab!=='timer'||S.modal||S.readOnly||e.repeat||['INPUT','SELECT','TEXTAREA','BUTTON'].includes(document.activeElement?.tagName))return;
 if(e.code==='Space'){e.preventDefault();void startHeat();}else if(e.code==='Digit1'){e.preventDefault();markFinish(chosenHeat().ids[0]);}else if(e.code==='Digit2'){e.preventDefault();markFinish(chosenHeat().ids[1]);}});
window.addEventListener('beforeunload',e=>{if(active()||S.outbox.length){e.preventDefault();e.returnValue='';}});
window.addEventListener('online',()=>void flush());
void boot();
