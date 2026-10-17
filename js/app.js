import {APPS_SCRIPT_URL, EVENT_ID} from './apps-script-config.js';
import {loadLocal,saveSnapshot,persistChange,removeOutbox,clearAll,clearOutbox} from './storage.js';
import {emptyData,uid,safe,msText,tsText,applyPatches,deepCopy,sortByBib,latestRuns,rankings,statusLabel,csvDownload,presetData,INDIVIDUAL_COUNT,TEAM_COUNT,padBib} from './core.js';
import {isConfigured,createCloud} from './cloud.js';

function perTabDeviceId(){
  try{let value=sessionStorage.getItem('ycps-clock-tab');if(!value){value=uid();sessionStorage.setItem('ycps-clock-tab',value);}return value;}catch{return uid();}
}
const state={
  configured:isConfigured(), cloud:null, mode:isConfigured()?'cloud':'local', user:null,connected:false,cloudLoaded:false,storageReady:false,
  data:presetData(emptyData()), outbox:[],tab:new URLSearchParams(location.search).get('view')==='mc'?'mc':'timer',
  type:'individual', selectedId:'',rankType:'individual',division:'all', search:'', currentClock:null,
  control:false, lockPending:false, sending:false, starting:false, finishing:false, offset:0, error:'',lastBackup:0,
  deviceId:perTabDeviceId(), modal:'', editId:'', toastCount:0,readOnly:new URLSearchParams(location.search).get('view')==='mc',backupAcknowledged:false,resetting:false
};
const app=document.querySelector('#app');
const normText=x=>String(x??'').trim().slice(0,140);
const htmlOptions=(items, value, label)=>items.map(x=>`<option value="${safe(x.id)}" ${x.id===value?'selected':''}>${safe(label(x))}</option>`).join('');
const isAdmin=()=>!state.readOnly;
const isViewer=()=>state.readOnly;
const canUse=()=>true;
const canClock=()=>isAdmin()&&state.control&&state.storageReady&&!state.resetting;
const list=(type)=>Object.values(state.data[type]||{});
const targets=()=>list(state.type==='individual'?'participants':'teams').sort(sortByBib);
const selected=()=>targets().find(x=>x.id===state.selectedId)||null;
const activeRun=()=>{const id=state.data.status?.current?.runId;return id?state.data.runs[id]:null;};
const modeName=t=>t==='individual'?'개인전 · 장애물 레이스':'단체전 · 4인 계주';
const entityName=(r)=>{
  if(!r)return '-';const x=state.data[r.type==='individual'?'participants':'teams']?.[r.targetId];
  return x?.name||x?.teamName||'(명단에서 삭제됨)';
};
const currentTarget=()=>{
  const r=activeRun();if(!r)return selected();
  return state.data[r.type==='individual'?'participants':'teams']?.[r.targetId]||null;
};
function notice(msg,kind='normal'){
  const root=document.querySelector('.toast-stack');if(!root)return;
  const el=document.createElement('div');el.className=`toast ${kind}`;el.textContent=msg;root.append(el);
  setTimeout(()=>el.remove(),5200);
}
function connectionName(){
  if(!state.storageReady)return ['기기 저장 불가 · 중단','bad'];
  if(state.mode==='local')return ['서버 미연결 · 기기 저장','warn'];
  if(!state.connected)return ['서버 연결 끊김','bad'];
  if(!state.cloudLoaded)return ['서버 기록 동기화 중','warn'];
  if(state.outbox.length)return [`미전송 ${state.outbox.length}건`,'warn'];
  return ['서버 저장 확인 정상','ok'];
}
function chooseDefault(){
  if(!targets().some(x=>x.id===state.selectedId)){
    const last=latestRuns(state.data,state.type);
    state.selectedId=targets().find(x=>!last[x.id]||last[x.id].status==='cancelled')?.id||targets()[0]?.id||'';
  }
}
function latestFor(type,id){return latestRuns(state.data,type)[id]||null;}
function formatError(e){return e?.message||String(e);}

// 기기 저장과 전송 대기열을 하나의 IndexedDB 트랜잭션으로 기록.
async function commit(patches,activity=''){
  if(!isAdmin())throw Error('운영자만 기록을 변경할 수 있습니다.');
  const updated=presetData(applyPatches(deepCopy(state.data),patches));
  const item=state.configured?{id:uid(),createdAt:Date.now(),patches,activity,generation:Number(state.data.meta?.generation||0)}:null;
  await persistChange(updated,item);
  state.data=updated;
  if(item)state.outbox.push(item);
  render();
  if(item)void flush();
}
async function flush(){
  if(!state.cloud||!state.connected||!state.cloudLoaded||!isAdmin()||state.sending||state.resetting)return;
  state.sending=true;
  try{
    while(state.outbox.length&&state.connected&&isAdmin()){
      const task=state.outbox[0];
      try{
        if(task.generation!==Number(state.data.meta?.generation||0)) throw Error('초기화 전 미전송 기록이 있습니다. 자동 재전송을 중단했습니다. 운영본부에서 백업 후 확인하세요.');
        await state.cloud.send(task.patches,task.generation,task.id,state.deviceId); // 서버 기록에서 요청 ID ACK 확인 후에만 대기열 삭제
        await removeOutbox(task.id);
        state.outbox.shift();
        renderHeader();
      }catch(e){
        state.error=`서버 저장 실패: ${formatError(e)}`;
        notice('서버 저장 실패. 기록은 기기에 보관되고 자동 재전송합니다.','error');
        break;
      }
    }
  }finally{state.sending=false;renderHeader();}
}
function eventDataUpdate(remote){
  if(!canUse())return;
  let data=Object.assign(emptyData(),remote||{});
  for(const task of state.outbox){
    if(task.generation===Number(data.meta?.generation||0)) data=applyPatches(data,task.patches);
    else state.error='초기화 이전에 생성된 미전송 기록이 남아 있습니다. 자동 전송이 중지되었습니다.';
  }
  state.data=presetData(data);
  state.cloudLoaded=true;
  chooseDefault();
  saveSnapshot(data).catch(e=>notice(`로컬 백업 오류: ${formatError(e)}`,'error'));
  render();
}
async function boot(){
  try{
    const local=await loadLocal();state.data=presetData(local.data||emptyData());
    state.outbox=local.queue.sort((a,b)=>a.createdAt-b.createdAt);
    state.storageReady=true;
    chooseDefault();
  }catch(e){state.error=`기기 저장소 오류: ${formatError(e)}`;}
  render();
  if(!state.configured){state.mode='local';state.control=true;render();return;}
  state.mode='cloud';render();
  try{
    state.cloud=await createCloud({
      onReady:user=>{state.user=user;render();},
      onData:eventDataUpdate,
      onConnected:connected=>{const changed=connected!==state.connected;state.connected=connected;if(changed)render();else renderHeader();if(connected)void flush();},
      onServerOffset:offset=>state.offset=offset,
      onError:error=>{state.error=`Apps Script 오류: ${formatError(error)}`;renderHeader();}
    });
  }catch(e){state.error=`Apps Script 연결 오류: ${formatError(e)}`;render();}
}
function header(){
  const [name,color]=connectionName();
  return `<header class="topbar"><div class="brand"><div class="brand-icon">Y26</div><div><div class="brand-kicker">YEONCHEON PHYSICAL SURVIVAL</div><h1>2026 연천피지컬 서바이벌</h1></div></div>
  <div class="header-right"><span id="connection-pill" class="status-pill ${color}">${safe(name)}</span>
  <span class="status-pill">${state.readOnly?'MC 조회 전용':state.mode==='local'?'단독 계측':'공용 계측'}</span>
</div></header>`;
}
function renderHeader(){
  const p=document.querySelector('#connection-pill');if(!p)return;
  const [name,color]=connectionName();p.className=`status-pill ${color}`;p.textContent=name;
  const queue=document.querySelector('#queue-count');if(queue)queue.textContent=String(state.outbox.length);
}
function nav(){
  const all=isViewer()?[['mc','MC 기록 화면'],['rank','기록·순위']]:[
    ['timer','경기 계측'],['slots','번호별 현황'],['dashboard','운영 현황'],['rank','기록·순위'],['mc','MC 화면'],['settings','운영·백업']
  ];
  return `<nav class="nav">${all.map(([id,txt])=>`<button data-tab="${id}" class="${state.tab===id?'active':''}">${txt}</button>`).join('')}</nav>`;
}
function subhead(over,title,detail='',right=''){
  return `<div class="view-heading"><div><div class="overline">${safe(over)}</div><h2>${safe(title)}</h2>${detail?`<div class="muted small">${safe(detail)}</div>`:''}</div>${right}</div>`;
}
function localStatusNotice(){
  if(!state.storageReady)return `<div class="banner red"><strong>기기 저장소 사용 불가 · 계측 중단</strong> 이 브라우저에서는 경기기록을 안전하게 저장할 수 없습니다. 저장소 오류를 해결하거나 기기를 변경하세요. ${safe(state.error)}</div>`;
  return state.mode==='local'?`<div class="banner"><strong>서버 미연결 · 이 기기 저장 중</strong> 기록은 현재 사용 중인 기기에만 보관됩니다. MC·운영본부 기록 공유는 Apps Script 웹 앱 연결 후 사용할 수 있습니다.</div>`:'';
}
function controlBox(){
  if(state.mode==='local')return `<div class="info-strip">단독 계측 상태입니다. 이 기기에서 기록을 보관하며 다른 기기에는 공유되지 않습니다.</div>`;
  return state.control?`<div class="info-strip success">이 기기가 계측 제어권을 보유 중입니다. 이 브라우저 탭을 경기 중 닫지 마세요. ${!state.connected?'(현재 오프라인: 다른 기기와 충돌할 수 있습니다.)':''}</div>`:
  `<div class="info-strip danger">계측 시작 전 이 기기에 제어권을 할당해야 합니다. 경기 중에는 **한 대의 계측 기기만** 사용하세요.</div><div class="section-gap"><button data-action="claim" class="btn primary" ${!state.connected||state.lockPending?'disabled':''}>계측 제어권 획득</button></div>`;
}
function progressInfo(type=state.type){
  const all=Object.values(state.data[type==='individual'?'participants':'teams']);
  const latest=latestRuns(state.data,type);
  const complete=all.filter(t=>latest[t.id]&&['finished','dnf','dsq'].includes(latest[t.id].status)).length;
  const finished=all.filter(t=>latest[t.id]?.status==='finished').length;
  return {total:all.length,complete,finished,waiting:all.length-complete};
}
function targetDropdown(){
  const all=targets(), chosen=selected(), p=progressInfo();
  const index=all.findIndex(t=>t.id===state.selectedId);
  const text=state.type==='individual'?'참가번호':'팀번호';
  return `<div class="count-progress"><div><span class="small muted">${text} 계측 진행 현황</span><div class="count-progress-number"><b>${p.complete}</b><span> / ${p.total} ${state.type==='individual'?'명':'팀'} 완료</span></div></div><div class="progress-rail"><div style="width:${p.total?p.complete/p.total*100:0}%"></div></div><span class="chip">대기 ${p.waiting}</span></div>
   <div class="slot-choice"><div class="slot-big-label"><div class="overline">NOW MEASURING</div><div class="target-name">${chosen?safe(chosen.name||chosen.teamName):'대상 없음'}</div><span class="small muted">${state.type==='relay'?'4명 1팀 · 선수명 등록 없음':'선수명 등록 없음 · 번호로만 계측'}</span></div>
   <div class="slot-navigation"><button class="btn" data-action="prev" ${activeRun()||index<=0?'disabled':''}>← 이전</button><select id="target-select" aria-label="측정 번호 선택" ${activeRun()?'disabled':''}>${htmlOptions(all,state.selectedId,t=>t.name||t.teamName)}</select><button class="btn primary" data-action="next" ${activeRun()||index===all.length-1?'disabled':''}>다음 →</button></div></div>
   <div class="jump-row"><div class="field"><label for="slot-jump">번호 바로 이동 (1~${p.total})</label><input id="slot-jump" type="number" min="1" max="${p.total}" inputmode="numeric" placeholder="번호 입력" ${activeRun()?'disabled':''}/></div><button class="btn" data-action="jump" ${activeRun()?'disabled':''}>번호 이동</button><button class="btn ghost" data-tab="slots" ${activeRun()?'disabled':''}>전체 번호판 보기</button></div>`;
}

function liveCurrentMs(){
  const r=activeRun();if(!r)return 0;
  if(state.currentClock?.runId===r.id)return Math.max(0,performance.now()-state.currentClock.perfStart);
  return Math.max(0,Date.now()-r.startedAt);
}
function timerView(){
  chooseDefault();const r=activeRun();const type=r?.type||state.type;
  const chosen=r?currentTarget():selected();const previous=Object.values(state.data.runs).filter(x=>x.status==='finished').sort((a,b)=>b.endedAt-a.endedAt).slice(0,6);
  const last=chosen?latestFor(type,chosen.id):null;
  const needRecover=r&&!state.currentClock;
  const done=last&&last.status!=='cancelled'&&!r;
  return `${subhead('RACE CONTROL','경기 계측','장애물 레이스 · 4인 계주 / 개인전 200명 · 단체전 50팀 사전 내장 / 1명·1팀씩 계측')}
    ${localStatusNotice()}
    <div class="layout-two"><section class="panel">
      <div class="panel-head"><h3>경기 타이머</h3><div class="chips"><span class="chip ${r?'warn':'good'}">${r?'● 경기 진행 중':'● 준비 완료'}</span><span class="chip">${state.control?'계측 제어권 보유':'제어권 필요'}</span></div></div>
      <div class="fields"><div class="field"><label>경기 종목</label><select id="race-type" ${r?'disabled':''}><option value="individual" ${state.type==='individual'?'selected':''}>개인전 · 001~200번</option><option value="relay" ${state.type==='relay'?'selected':''}>단체전 · 01~50팀 (4인 계주)</option></select></div>
       <div class="field"><label>사전 설정 완료</label><input readonly value="${state.type==='individual'?'001~200번 · 200명 내장':'01~50팀 · 50팀 내장'}" /></div></div>
      <div class="hr"></div>${r?`<div class="target-name">${safe(entityName(r))}</div><div class="small muted">${safe(modeName(r.type))} · ${tsText(r.startedAt)} 출발</div>`:targetDropdown()}
      <div class="timer-face ${r?'running':''}"><div class="overline">${r?'TIME RUNNING':'STOPWATCH'}</div><div id="live-clock" class="time">${msText(r?liveCurrentMs():done&&last.status==='finished'?last.elapsedMs:0)}</div><div class="timer-status" id="timer-status">${r?'경기가 진행 중입니다. 종료 시 즉시 기기에 저장됩니다.':done?`이전 기록: ${statusLabel(last)} / 새 경기에는 재경기 승인 필요`:'출발 신호와 동시에 시작을 누르세요.'}</div></div>
      ${needRecover?`<div class="info-strip danger">페이지가 다시 열렸습니다. 초정밀 타이머가 중단되어 이후 시간은 시스템 시각으로 추정됩니다. 이 경기의 공식 확정 전 수동 판정을 진행하세요.</div>`:''}
      <div class="action-row"><button class="action-btn start" data-action="start" ${!canClock()||r||!chosen||done?'disabled':''}>▶ 시작</button><button class="action-btn stop" data-action="finish" ${!canClock()||!r?'disabled':''}>■ 종료</button></div>
      <div class="tools section-gap"><button class="btn sm ghost" data-action="dnf" ${!canClock()||!chosen?'disabled':''}>미완주 처리</button><button class="btn sm ghost" data-action="dsq" ${!canClock()||!chosen?'disabled':''}>실격 처리</button></div>
      <div class="hr"></div>${controlBox()}
      ${state.mode==='local'?'':`<div class="control-card section-gap"><span>서버 미전송 기록</span><b><span id="queue-count">${state.outbox.length}</span>건</b></div>`}
      <p class="notice-line">키보드 단축키: <span class="kbd">Space</span> 시작 · <span class="kbd">Enter</span> 종료. 종료 기록은 잠정 기록으로 저장됩니다. 재경기 및 수동 변경은 기록 관리에서 처리하세요.</p>
      </section>
      <aside class="stack"><section class="panel"><div class="panel-head"><h3>최근 경기기록</h3><button class="btn sm" data-tab="rank">전체 보기</button></div>
      ${previous.length?`<div class="stack">${previous.map(x=>`<div class="list-item"><div><b>${safe(entityName(x))}</b><div class="muted tiny">${safe(modeName(x.type))} · ${tsText(x.endedAt)}</div></div><div style="text-align:right"><b>${msText(x.elapsedMs)}</b><div class="tiny ${x.verified?'':'muted'}">${x.verified?'확정':'잠정'}</div></div></div>`).join('')}</div>`:'<div class="empty">아직 저장된 기록이 없습니다.</div>'}
      </section><section class="panel"><h3>현장 운영 원칙</h3><div class="notice-line">① 경기 전 계측 제어권을 획득합니다.<br/>② 시작 시 즉시 계측하고 종료 기록은 기기에 먼저 저장합니다.<br/>③ 서버 저장 완료와 공식 기록 확정은 별개의 상태입니다.<br/>④ 접전·재시작·오작동은 보조 스톱워치와 영상으로 확인합니다.</div></section></aside></div>`;
}
function dashboard(){
  const pi=progressInfo('individual'),pt=progressInfo('relay');
  const r=activeRun();
  return `${subhead('OPERATIONS OVERVIEW','운영 현황','개인전 200명 · 단체전 50팀 고정 번호 · 별도 등록 없음')}${localStatusNotice()}
  <div class="cards"><div class="metric"><label>개인전 총인원</label><strong>${pi.total}</strong><small>명</small></div><div class="metric"><label>개인전 계측 완료</label><strong>${pi.complete}</strong><small>명</small></div><div class="metric"><label>단체전 총팀</label><strong>${pt.total}</strong><small>팀</small></div><div class="metric"><label>단체전 계측 완료</label><strong>${pt.complete}</strong><small>팀</small></div></div>
  <div class="layout-two"><section class="panel"><div class="panel-head"><h3>현재 경기</h3><span class="badge ${r?'pending':''}">${r?'진행 중':'대기 중'}</span></div>
   <div class="timer-face ${r?'running':''}"><div class="overline">${r?safe(modeName(r.type)):'READY'}</div><div class="time" id="live-clock">${msText(r?liveCurrentMs():0)}</div><div class="timer-status">${r?safe(entityName(r)):'다음 경기를 기다리고 있습니다'}</div></div>
   <div class="quick-grid"><button class="quick-card" data-tab="timer">경기 제어<strong>계측 시작 →</strong></button><button class="quick-card" data-tab="slots">고정 번호 현황<strong>001~200 / 01~50 →</strong></button></div>
   <p class="notice-line">개인전 대기 ${pi.waiting}명 · 단체전 대기 ${pt.waiting}팀 · 서버 미전송 ${state.outbox.length}건</p></section>
  <section class="stack"><div class="panel"><h3>경기 운영 상태</h3><div class="hr"></div><div class="control-card"><span>기록 서버</span><b>${state.mode==='local'?'미연결 · 기기 저장':state.connected?'연결됨':'연결 안 됨'}</b></div><div class="control-card section-gap"><span>계측 제어권</span><b>${state.control?'이 기기 보유':'미획득'}</b></div><div class="control-card section-gap"><span>전송 대기열</span><b>${state.outbox.length}건</b></div><div class="section-gap">${controlBox()}</div></div>
  <div class="panel"><h3>내장 번호 사용법</h3><p class="notice-line">① 개인전 001~200번, 단체전 01~50팀이 기본 준비됩니다.<br/>② 경기 계측에서 종목과 번호 선택 → 시작 → 종료.<br/>③ 저장 후 자동으로 다음 대기 번호를 선택합니다.<br/>④ 별도 선수 등록은 필요하지 않습니다.</p></div></section></div>`;
}
function slotsView(){
  const all=targets(),latest=latestRuns(state.data,state.type),progress=progressInfo();
  return `${subhead('NUMBER BOARD','번호별 현황', '개인전 200번 / 단체전 50팀. 버튼을 누르면 해당 번호로 이동합니다.')}${localStatusNotice()}
  <section class="panel"><div class="fields"><div class="field"><label>종목 선택</label><select id="slot-type" ${activeRun()?'disabled':''}><option value="individual" ${state.type==='individual'?'selected':''}>개인전 · 001~200번</option><option value="relay" ${state.type==='relay'?'selected':''}>단체전 · 01~50팀</option></select></div>
  <div class="field"><label>번호 진행 현황</label><div class="count-inline">완료 <b>${progress.complete}</b> / ${progress.total} · 대기 <b>${progress.waiting}</b></div></div></div>
  <div class="slot-legend section-gap"><span>● 대기</span><span class="done">● 종료</span><span class="special">● 실격·미완주</span><span class="current">● 현재 선택</span></div>
  <div class="slot-grid section-gap">${all.map(x=>{
    const run=latest[x.id],done=run?.status==='finished',other=run&&run.status!=='cancelled'&&!done;
    return `<button class="slot-tile ${state.selectedId===x.id?'selected':''} ${done?'done':other?'other':''}" data-action="pick-slot" data-id="${x.id}" ${activeRun()?'disabled':''}>
    <b>${safe(x.bib)}</b><span>${done?msText(run.elapsedMs):other?statusLabel(run):'대기'}</span></button>`;
  }).join('')}</div>
  <p class="notice-line">종료된 번호를 다시 선택해도 재계측이 자동으로 시작되지 않습니다. 잘못된 기록은 기록·순위 화면에서 사유를 남겨 수정하세요.</p></section>`;
}

function rankAt(rows,i){return rows.findIndex(x=>x.run.elapsedMs===rows[i].run.elapsedMs)+1;}
function badgeFor(r){
  const label=statusLabel(r),c=label==='확정'?'':label==='실격'||label==='미완주'?'danger':'pending';
  return `<span class="badge ${c}">${label}</span>`;
}
function rankView(){
  const rows=rankings(state.data,state.rankType,'all');const top=rows.slice(0,3);
  const allLast=latestRuns(state.data,state.rankType);
  const others=Object.values(state.rankType==='individual'?state.data.participants:state.data.teams).filter(t=>!rows.some(x=>x.id===t.id)).sort(sortByBib);
  return `${subhead('LIVE RESULTS','기록·순위','종료 즉시 잠정 순위에 반영되며 확정 기록은 별도로 구분됩니다.')}${localStatusNotice()}
  <div class="panel"><div class="fields"><div class="field"><label>경기 종목</label><select id="rank-type"><option value="individual" ${state.rankType==='individual'?'selected':''}>개인전 · 200명</option><option value="relay" ${state.rankType==='relay'?'selected':''}>단체전 · 50팀</option></select></div><div class="field"><label>관리 방식</label><input readonly value="번호별 기록 · 이름 등록 없음" /></div></div>
  <div class="rank-top section-gap">${[0,1,2].map(i=>{const t=top[i];return `<div class="rank-card"><div class="number">${t?rankAt(rows,i):i+1}<small style="font-size:15px">위</small></div><strong>${t?safe(t.name||t.teamName):'—'}</strong><div class="time">${t?msText(t.run.elapsedMs):'--:--.--'}</div>${t?badgeFor(t.run):'<span class="muted small">기록 대기</span>'}</div>`;}).join('')}</div>
  <div class="panel-head section-gap"><h3>전체 기록 <span class="muted">(${rows.length}건)</span></h3><div class="tools"><button class="btn sm" data-action="export-results">CSV 결과 다운로드</button></div></div>
  <div class="table-wrap"><table><thead><tr><th>순위</th><th>참가자·팀</th><th>구분</th><th>시간</th><th>상태</th>${isAdmin()?'<th>관리</th>':''}</tr></thead><tbody>${rows.map((t,i)=>`<tr><td class="rank">${rankAt(rows,i)}</td><td><b>${safe(t.name||t.teamName)}</b><div class="tiny muted">${safe(t.bib||t.affiliation||'')}</div></td><td>${safe(t.division||'계주')}</td><td><b>${msText(t.run.elapsedMs)}</b></td><td>${badgeFor(t.run)}${t.run.accuracy==='estimated'?'<div class="tiny" style="color:var(--red)">복구 후 추정값</div>':''}</td>${isAdmin()?`<td><div class="tools"><button class="btn sm" data-action="edit-run" data-id="${safe(t.run.id)}">수정</button>${!t.run.verified?`<button class="btn sm primary" data-action="verify-run" data-id="${safe(t.run.id)}">확정</button>`:''}</div></td>`:''}</tr>`).join('')}
  ${others.map(t=>{const r=allLast[t.id];return `<tr><td>—</td><td><b>${safe(t.name||t.teamName)}</b></td><td>${safe(t.division||'계주')}</td><td>—</td><td>${badgeFor(r)}</td>${isAdmin()?`<td>${r?`<button class="btn sm" data-action="edit-run" data-id="${safe(r.id)}">수정</button>`:''}</td>`:''}</tr>`;}).join('')}
  ${!rows.length&&!others.length?`<tr><td colspan="6" class="empty">아직 참가자나 기록이 없습니다.</td></tr>`:''}</tbody></table></div>
  <p class="notice-line">※ 순위는 시간 오름차순 자동 정렬됩니다. 동시간 기록은 동순위 판정이 필요할 수 있으므로 시상 전 수동 확인하세요. 수동 조정·복구 추정 기록은 반드시 검증 후 확정하세요.</p>
  </div>`;
}
function mcView(){
  const r=activeRun();const current=state.data.status?.current;
  const stale=r&&current?.heartbeatAt&&Date.now()-current.heartbeatAt>30000;
  const individual=rankings(state.data,'individual').slice(0,10);
  const relay=rankings(state.data,'relay').slice(0,10);
  return `<div class="mc-header"><div class="overline">OFFICIAL LIVE SCOREBOARD</div><h1>2026 연천피지컬 서바이벌</h1><p class="muted">MC · 운영본부 기록 조회 (약 5초 간격 갱신) · 번호 기준</p></div>
   ${localStatusNotice()}
   ${state.mode!=='local'&&!state.connected?'<div class="banner red">서버 연결이 끊겼습니다. 화면의 기록은 최신 정보가 아닐 수 있습니다.</div>':''}
   <div class="mc-clock"><div class="overline">${r?safe(modeName(r.type)):'NOW READY'}</div><h2>${r?safe(entityName(r)):'다음 경기를 준비합니다'}</h2><div class="time" id="live-clock">${r?msText(Math.max(0,Date.now()+state.offset-r.startedAt)):'00:00.00'}</div>
   <span class="badge ${r?'pending':''}">${r?(stale?'계측기 통신 지연 · 시간 참고용':'현재 경기 진행 중 · 시간 참고용'):'경기 대기'}</span>
   <div class="notice-line">진행 중 시간은 참고용입니다. 공식 기록은 계측 기기의 종료 기록을 기준으로 합니다.</div></div>
   <div class="mc-grid two section-gap">${[[individual,'개인전 TOP 10'],[relay,'단체전 TOP 10']].map(([rows,name])=>`<section class="panel"><div class="panel-head"><h3>${name}</h3><span class="badge">약 5초 간격 갱신</span></div>
   <div class="stack">${rows.length?rows.map((x,i)=>`<div class="list-item"><div class="pill-row"><span class="rank">${rankAt(rows,i)}</span><div><b>${safe(x.name||x.teamName)}</b></div></div><div style="text-align:right"><strong>${msText(x.run.elapsedMs)}</strong><div class="tiny muted">${x.run.verified?'확정':'잠정'}</div></div></div>`).join(''):'<div class="empty">경기 종료 기록을 기다리고 있습니다.</div>'}</div></section>`).join('')}</div>`;
}

function settingsView(){
  const audits=Object.values(state.data.audit||{}).sort((a,b)=>b.at-a.at).slice(0,25);
  const staleQueue=state.outbox.some(x=>x.generation!==Number(state.data.meta?.generation||0));
  return `${subhead('CONTROL & BACKUP','운영·백업 설정','기록 안전성과 행사 전 점검을 위한 메뉴')}${localStatusNotice()}
   <div class="layout-two"><section class="stack"><div class="panel"><h3>저장 및 연결 상태</h3><div class="stack section-gap">
     <div class="control-card"><span>Apps Script 주소</span><b>${state.configured?'설정됨':'미설정 · 단독 계측'}</b></div>
     <div class="control-card"><span>연결 상태</span><b>${state.mode==='local'?'기기 내부 저장':state.connected?'서버 연결':'서버 연결 끊김'}</b></div>
     <div class="control-card"><span>서버 미전송</span><b id="queue-count">${state.outbox.length}</b></div>
     <div class="control-card"><span>계측 제어권</span><b>${state.control?'이 기기 보유':'미보유'}</b></div>
   </div><div class="tools section-gap"><button class="btn" data-action="retry" ${!state.connected||!state.outbox.length?'disabled':''}>미전송 기록 재전송</button>${state.mode!=='local'?`<button class="btn" data-action="claim" ${!isAdmin()||!state.connected?'disabled':''}>제어권 갱신</button><button class="btn ghost" data-action="release" ${!state.control?'disabled':''}>제어권 반납</button>`:''}</div>
   ${state.error?`<div class="banner red">${safe(state.error)}</div>`:''}</div>
   ${staleQueue?`<div class="panel"><h3>이전 회차 미전송 기록 발견</h3><div class="banner red">다른 기기에서 기록 초기화가 실행되어 이 기기의 전송 대기 기록을 서버에 전송할 수 없습니다. JSON 백업 후 폐기 여부를 확인해야 계측을 재개할 수 있습니다.</div><div class="tools section-gap"><button class="btn" data-action="export-json">미전송 포함 JSON 백업</button><button class="btn" data-action="discard-stale">이전 기록 전송 대기 폐기</button></div></div>`:''}
   <div class="panel"><h3>기록 초기화</h3><p class="notice-line">개인전·단체전·전체 기록을 초기화할 수 있습니다. 내장된 200명·50팀 번호는 유지됩니다. 초기화 전 반드시 JSON 백업이 필요하며, 다른 기기에도 결과가 반영됩니다. 로그인 없는 공개 운영 방식은 누구든 기록을 바꿀 수 있으므로 링크 공유에 주의하세요.</p><button class="btn" data-action="open-reset" ${state.readOnly||state.resetting?'disabled':''}>기록 초기화 관리</button></div>
   <div class="panel"><h3>결과 자료 백업</h3><p class="notice-line">CSV 파일은 Excel에서 열 수 있습니다. 실제 행사 기록은 별도의 PC와 USB에도 백업하는 것을 권장합니다.</p>
   <div class="stack section-gap"><button class="btn primary" data-action="export-all">전체 기록 CSV 내려받기</button><button class="btn" data-action="export-people">개인 200명 번호·기록 CSV</button><button class="btn" data-action="export-teams">단체 50팀 번호·기록 CSV</button><button class="btn" data-action="export-history">전체 계측 시도 이력 CSV</button><button class="btn" data-action="export-audit">수정 이력 CSV</button></div></div></section>
   <section class="panel"><h3>기록 변경 이력</h3><div class="stack section-gap">${audits.length?audits.map(x=>`<div class="list-item"><div><b>${safe(x.action)}</b><div class="muted tiny">${safe(x.detail||'')}</div><div class="muted tiny">${tsText(x.at)}</div></div><span class="chip">${safe(x.actor||'LOCAL')}</span></div>`).join(''):'<div class="empty">아직 수정 이력이 없습니다.</div>'}</div></section></div>`;
}
function exportJson(){
  const filename=`2026_연천피지컬_전체백업_${new Date().toISOString().replaceAll(':','-')}.json`;
  const blob=new Blob([JSON.stringify({eventId:EVENT_ID,exportedAt:new Date().toISOString(),data:state.data,pendingOutbox:state.outbox},null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
}
async function discardStaleOutbox(){
 const stale=state.outbox.some(x=>x.generation!==Number(state.data.meta?.generation||0));
 if(!stale)throw Error('폐기할 과거 미전송 기록이 없습니다.');
 if(!state.backupAcknowledged)throw Error('먼저 미전송 포함 JSON 백업 파일을 저장하세요.');
 if(!confirm('과거 미전송 기록을 폐기할까요? 취소된 기록은 서버에 전송되지 않습니다.'))return;
 if(!confirm('마지막 확인: 저장된 JSON 백업을 확인했으며 서버에 전송되지 않아도 괜찮습니까?'))return;
 await clearOutbox();state.outbox=[];state.backupAcknowledged=false;state.error='';
 render();notice('이전 회차 미전송 대기열을 폐기했습니다.','good');
}
function resetModal(){
  const active=Boolean(activeRun());
  return `<div class="dialog-backdrop" id="dialog-backdrop"><div class="dialog" role="dialog" aria-modal="true"><h3>경기 기록 초기화</h3>
  <div class="banner red">주의: 서버에 저장된 기록이 변경되며 다른 PC·MC 화면도 함께 초기화됩니다. 로그인 없는 운영 방식은 외부인 조작에 취약합니다. 참가번호 200개와 팀번호 50개는 유지됩니다.</div>
  <p class="notice-line">① 백업 다운로드 → ② 다운로드 파일 확인 → ③ 초기화 범위 선택 → ④ 확인 문구 입력</p>
  <button type="button" class="btn primary" data-action="export-json">1. 전체 기록 JSON 백업 다운로드</button>
  <form class="stack section-gap" id="reset-form">
  <div class="field"><label>초기화 범위</label><select name="scope"><option value="individual">개인전 200명 기록만</option><option value="relay">단체전 50팀 기록만</option><option value="all">개인전 + 단체전 전체 기록</option></select></div>
  <label class="small"><input type="checkbox" name="backup" required ${state.backupAcknowledged?'':'disabled'} /> 다운로드한 JSON 파일을 실제로 확인했습니다</label>
  <div class="field"><label>확인 문구 · 정확히 <b>기록초기화</b> 입력</label><input name="phrase" required autocomplete="off" placeholder="기록초기화" /></div>
  ${active?'<div class="banner red">경기가 진행 중입니다. 종료 후에만 초기화할 수 있습니다.</div>':''}
  ${state.outbox.length?'<div class="banner red">서버 미전송 기록이 있습니다. 먼저 전송을 완료하세요.</div>':''}
  <div class="actions"><button type="button" class="btn" data-action="close-modal">취소</button><button class="btn" type="submit" ${active||state.outbox.length||!state.backupAcknowledged||state.resetting?'disabled':''}>기록 초기화 실행</button></div>
  </form></div></div>`;
}
async function resetRecords(form){
  if(state.resetting||state.readOnly)throw Error('현재 이 화면에서는 초기화할 수 없습니다.');
  const d=new FormData(form),scope=String(d.get('scope'));
  if(!['individual','relay','all'].includes(scope))throw Error('초기화 범위가 잘못됐습니다.');
  if(!state.backupAcknowledged||d.get('backup')!=='on')throw Error('백업 파일을 실제로 저장한 뒤 확인하세요.');
  if(String(d.get('phrase')||'').trim()!=='기록초기화')throw Error('확인 문구가 일치하지 않습니다.');
  if(activeRun()||state.starting||state.finishing)throw Error('진행 중인 경기를 먼저 종료하세요.');
  if(state.outbox.length||state.sending)throw Error('미전송 데이터가 있습니다. 서버 저장 완료를 확인하세요.');
  if(state.configured&&(!state.cloud||!state.connected||!state.cloudLoaded))throw Error('서버가 연결되어야 전체 기기 기록을 초기화할 수 있습니다.');
  const label=scope==='individual'?'개인전 200명':scope==='relay'?'단체전 50팀':'개인전·단체전 전체';
  if(!confirm(`${label} 기록을 초기화할까요?\n이 작업은 다른 기기에도 반영되며 복구는 백업 파일을 이용해야 합니다.`))return;
  state.resetting=true;state.modal='';render();
  try{
    if(state.configured){
      const next=await state.cloud.reset(scope,Number(state.data.meta?.generation||0));
      state.data=presetData(Object.assign(emptyData(),next||{}));
      await saveSnapshot(state.data);
      state.control=false;
    }else{
      const next=deepCopy(state.data);
      if(scope==='all'){next.runs={};next.audit={};}
      else next.runs=Object.fromEntries(Object.entries(next.runs||{}).filter(([,r])=>r.type!==scope));
      next.status={...(next.status||{}),current:null};
      next.meta={...(next.meta||{}),generation:Number(next.meta?.generation||0)+1,resetAt:Date.now(),resetScope:scope};
      const id=`audit_${uid().replaceAll('-','')}`;
      next.audit[id]={id,action:'기록 초기화',detail:label,at:Date.now(),actor:'LOCAL'};
      await clearAll();await saveSnapshot(presetData(next));state.data=presetData(next);
    }
    state.selectedId='';state.currentClock=null;chooseDefault();state.backupAcknowledged=false;
    notice(`${label} 기록 초기화 완료. 번호 슬롯은 유지됩니다.`,'good');
  }catch(e){state.error=`초기화 실패: ${formatError(e)}`;notice(state.error,'error');}
  finally{state.resetting=false;render();}
}
function modalHtml(){
  if(!state.modal)return '';
  if(state.modal==='reset')return resetModal();
  if(state.modal==='edit-run'){
    const r=state.data.runs[state.editId];if(!r)return '';
    return `<div class="dialog-backdrop" id="dialog-backdrop"><div class="dialog" role="dialog" aria-modal="true"><h3>경기기록 수정 · ${safe(entityName(r))}</h3><p class="small muted">기록 수정은 이력에 남고 확정 상태가 해제됩니다.</p>
    <form id="edit-run-form" class="stack"><div class="field"><label>상태</label><select name="status"><option value="finished" ${r.status==='finished'?'selected':''}>정상 종료</option><option value="dnf" ${r.status==='dnf'?'selected':''}>미완주</option><option value="dsq" ${r.status==='dsq'?'selected':''}>실격</option><option value="cancelled" ${r.status==='cancelled'?'selected':''}>취소·재경기 허용</option></select></div>
    <div class="field"><label>기록 (초) · 예: 36.42</label><input name="seconds" inputmode="decimal" type="number" step="0.01" min="0" max="36000" value="${r.elapsedMs===null||r.elapsedMs===undefined?'':(r.elapsedMs/1000).toFixed(2)}"/></div>
    <div class="field"><label>수정 사유 *</label><textarea rows="3" name="reason" required maxlength="250" placeholder="예: 결승 영상 확인 결과 0.30초 수정"></textarea></div>
    <div class="actions"><button type="button" class="btn" data-action="close-modal">취소</button><button class="btn primary" type="submit">수정 내역 저장</button></div></form></div></div>`;
  }
  return '';
}
function render(){
  const body=(({
    timer:timerView,slots:slotsView,dashboard,rank:rankView,mc:mcView,settings:settingsView
  })[isViewer()&&!['rank','mc'].includes(state.tab)?'mc':state.tab]||timerView)();
  app.innerHTML=`<div class="app-shell">${header()}${nav()}<main>${body}</main><footer class="footer"><span>2026 연천피지컬 서바이벌 · 경기 기록관리 v1.4</span><span>기록은 공식 승인 전 잠정 결과입니다.</span></footer></div>${modalHtml()}<div class="toast-stack" role="status" aria-live="polite"></div>`;
  refreshClock();
}
function refreshClock(){
  const el=document.getElementById('live-clock');if(!el)return;
  const r=activeRun();
  if(state.tab==='mc')el.textContent=r?msText(Math.max(0,Date.now()+state.offset-r.startedAt)):'00:00.00';
  else if(r)el.textContent=msText(liveCurrentMs());
}
setInterval(refreshClock,40);
setInterval(()=>{if(state.outbox.length)void flush();},6000);
setInterval(async()=>{
  if(!state.cloud||!state.control||!state.connected||!isAdmin())return;
  try{
    const good=await state.cloud.claim(state.deviceId);
    if(!good){state.control=false;notice('다른 기기가 계측 제어권을 획득했습니다.','error');render();return;}
    const r=activeRun();
    if(r&&!state.outbox.length)await state.cloud.send({'status/current/heartbeatAt':Date.now()},Number(state.data.meta?.generation||0),uid(),state.deviceId);
  }catch(e){state.error=`계측 제어권 갱신 실패: ${formatError(e)}`;renderHeader();}
},20000);

async function claim(){
  if(state.mode==='local'){state.control=true;render();return;}
  if(!isAdmin()||!state.connected||!state.cloudLoaded||!state.cloud)return notice('서버 데이터 동기화를 기다려주세요.','error');
  state.lockPending=true;render();
  try{state.control=await state.cloud.claim(state.deviceId);notice(state.control?'계측 제어권을 획득했습니다.':'다른 기기에서 이미 계측 중입니다.',state.control?'good':'error');}
  catch(e){notice(formatError(e),'error');}finally{state.lockPending=false;render();}
}
async function releaseControl(){
  if(activeRun())return notice('진행 중 경기를 종료한 후 반납하세요.','error');
  try{if(state.cloud&&state.connected)await state.cloud.release(state.deviceId);state.control=false;notice('계측 제어권을 반납했습니다.');render();}
  catch(e){notice(formatError(e),'error');}
}
function stepTarget(direction){
  if(activeRun())return;
  const all=targets(),index=all.findIndex(x=>x.id===state.selectedId);
  if(index<0||index+direction<0||index+direction>=all.length)return;
  state.selectedId=all[index+direction].id;render();
}
function jumpTarget(){
  if(activeRun())return;
  const input=document.getElementById('slot-jump');
  const n=Number(input?.value),all=targets();
  if(!Number.isInteger(n)||n<1||n>all.length)return notice(`1~${all.length} 사이의 번호를 입력하세요.`, 'error');
  state.selectedId=all[n-1].id;render();
}

async function startRace(){
  if(!canClock())return notice('계측 제어권이 필요합니다.','error');
  if(state.starting||activeRun())return notice('이미 진행 중이거나 시작 처리 중인 경기가 있습니다.','error');
  // 서버 연동 모드에서는 연결 불안정/미전송 이력이 있으면 새로운 출발을 막습니다.
  // 진행 중인 경기의 종료는 오프라인에서도 허용해 결승 기록을 보호합니다.
  if(state.configured && (!state.connected || !state.cloudLoaded || state.outbox.length))
    return notice('서버 동기화 대기 중입니다. 연결 및 미전송 기록 저장을 확인한 뒤 출발하세요.','error');
  const t=selected();if(!t)return notice('선수 또는 팀을 선택하세요.','error');
  const prev=latestFor(state.type,t.id);
  if(prev && prev.status!=='cancelled')return notice('이미 기록이 있습니다. 기록 관리에서 기존 기록을 취소해야 재경기할 수 있습니다.','error');
  if(state.type==='relay'&&t.members?.length!==4)return notice('단체전은 4인 계주 방식으로 계측합니다.','error');
  state.starting=true;
  const mark=performance.now(),now=Date.now();
  const id=`run_${uid().replaceAll('-','')}`;
  const run={id,type:state.type,targetId:t.id,startedAt:now,endedAt:null,elapsedMs:null,status:'running',verified:false,accuracy:'monotonic',createdBy:state.user?.uid||'local',deviceId:state.deviceId,updatedAt:now};
  state.currentClock={runId:id,perfStart:mark};
  try{await commit({[`runs/${id}`]:run,'status/current':{runId:id,type:state.type,targetId:t.id,startedAt:now,heartbeatAt:now}},'경기 출발');notice('경기 시작! 계측 중입니다.','good');}
  catch(e){state.currentClock=null;notice(`기기 저장 오류: ${formatError(e)}`,'error');}
  finally{state.starting=false;}
}
async function finishRace(status='finished'){
  if(!canClock()||state.finishing)return;
  const r=activeRun();if(!r)return;
  state.finishing=true;
  const now=Date.now();let elapsed=null;
  let accuracy=r.accuracy;
  if(status==='finished'){
    if(state.currentClock?.runId===r.id)elapsed=Math.max(0,performance.now()-state.currentClock.perfStart);
    else {elapsed=Math.max(0,now-r.startedAt);accuracy='estimated';}
    elapsed=Math.round(elapsed/10)*10;
  }
  const updated={...r,endedAt:now,elapsedMs:elapsed,status,accuracy,verified:false,updatedAt:now};
  try{
    await commit({[`runs/${r.id}`]:updated,'status/current':null},`경기 ${status}`);
    state.currentClock=null;
    notice(status==='finished'?`기록 ${msText(elapsed)} 기기에 저장됨${state.outbox.length?' · 서버 전송 대기':''}`:`${status.toUpperCase()} 처리 완료`,'good');
    // 종료 후 다음 측정되지 않은 번호로 자동 이동합니다.
    const all=targets();const done=latestRuns(state.data,r.type);
    const start=all.findIndex(x=>x.id===r.targetId);
    const pending=t=>!done[t.id]||done[t.id].status==='cancelled';
    const next=all.slice(start+1).find(pending)||all.slice(0,start).find(pending);
    if(next)state.selectedId=next.id;
    render();
  }catch(e){notice(`기록 저장 오류! 보조 계측기에서 즉시 확인하세요: ${formatError(e)}`,'error');}
  finally{state.finishing=false;}
}
async function absentRace(status){
  if(!canClock())return;
  if(activeRun()){if(!confirm(`진행 중 경기를 ${status==='dnf'?'미완주':'실격'} 처리할까요?`))return;return finishRace(status);}
  const t=selected();if(!t)return;
  const previous=latestFor(state.type,t.id);if(previous&&previous.status!=='cancelled')return notice('이미 기록이 있습니다. 기록 관리에서 기존 기록을 수정하세요.','error');
  if(!confirm(`${t.name||t.teamName} 선수를 ${status==='dnf'?'미완주':'실격'} 처리할까요?`))return;
  const now=Date.now(),id=`run_${uid().replaceAll('-','')}`;
  const r={id,type:state.type,targetId:t.id,startedAt:now,endedAt:now,elapsedMs:null,status,verified:false,accuracy:'manual',createdBy:state.user?.uid||'local',deviceId:state.deviceId,updatedAt:now};
  await commit({[`runs/${id}`]:r},status);
  const all=targets(), from=all.findIndex(x=>x.id===t.id), done=latestRuns(state.data,state.type);
  const next=all.slice(from+1).find(x=>!done[x.id]||done[x.id].status==='cancelled');
  if(next)state.selectedId=next.id;render();
  notice('상태가 저장되었습니다.','good');
}
async function auditChange(patches,action,detail){
  const id=`audit_${uid().replaceAll('-','')}`;
  patches[`audit/${id}`]={id,action,detail:String(detail).slice(0,280),at:Date.now(),actor:state.user?.email||'LOCAL'};
  await commit(patches,action);
}
async function verifyRun(id){
  const r=state.data.runs[id];if(!r||r.status!=='finished')return;
  if(r.accuracy==='estimated'&&!confirm('복구 후 추정된 시간입니다. 영상 또는 보조 계측으로 확인했습니까?'))return;
  await auditChange({[`runs/${id}`]:{...r,verified:true,updatedAt:Date.now()}},'공식 기록 확정',`${entityName(r)} · ${msText(r.elapsedMs)}`);
  notice('공식 기록으로 확정했습니다.','good');
}
async function editRun(form){
  const r=state.data.runs[state.editId];if(!r)return;
  if(r.status==='running')return notice('진행 중 경기는 계측 화면에서 종료·미완주·실격 처리하세요.','error');
  const values=new FormData(form);const status=String(values.get('status'));const reason=normText(values.get('reason'));
  const sec=Number(values.get('seconds'));if(!reason)return notice('수정 사유를 입력하세요.','error');
  if(status==='finished'&&(String(values.get('seconds')).trim()===''||!Number.isFinite(sec)||sec<0||sec>36000))return notice('기록 시간을 초 단위로 입력하세요.','error');
  const updated={...r,status,elapsedMs:status==='finished'?Math.round(sec*1000/10)*10:null,accuracy:'manual',verified:false,endedAt:r.endedAt||Date.now(),updatedAt:Date.now()};
  await auditChange({[`runs/${r.id}`]:updated},'기록 수동 수정',`${entityName(r)} · ${msText(r.elapsedMs)} → ${msText(updated.elapsedMs)} / ${reason}`);
  if(activeRun()?.id===r.id&&status!=='running')state.currentClock=null;
  state.modal='';render();notice('수정 이력을 남기고 저장했습니다.','good');
}
function guardCsvCell(s){const t=String(s??'');return /^[=+@\-\t\r]/.test(t)?`'${t}`:t;}
function exportData(kind){
  const date=new Date().toISOString().slice(0,10);
  const people=list('participants').sort(sortByBib),teams=list('teams').sort(sortByBib);
  const pi=latestRuns(state.data,'individual'),pt=latestRuns(state.data,'relay');
  const allRuns=Object.values(state.data.runs).sort((a,b)=>(a.startedAt||0)-(b.startedAt||0));
  let heads,rows,name;
  if(kind==='audit'){
    heads=['일시','작업','내용','작업자'];rows=Object.values(state.data.audit).map(a=>[tsText(a.at),a.action,a.detail,a.actor]);name=`2026_경기기록_수정이력_${date}.csv`;
  }else{
    heads=['종목','번호','기록(초)','상태','승인','측정 방식','출발시각','종료시각'];
    const runRow=(r,t,type)=>[modeName(type),t.bib||'',r?.elapsedMs==null?'':(r.elapsedMs/1000).toFixed(2),statusLabel(r),r?.verified?'확정':'미확정',r?.accuracy||'',tsText(r?.startedAt),tsText(r?.endedAt)];
    if(kind==='history'){
      rows=allRuns.map(r=>runRow(r,state.data[r.type==='individual'?'participants':'teams'][r.targetId]||{bib:r.targetId},r.type));
      name=`2026_경기기록_전체시도_${date}.csv`;
    }else if(kind==='people'){
      rows=people.map(t=>runRow(pi[t.id],t,'individual'));name=`2026_개인전_200명_${date}.csv`;
    }else if(kind==='teams'){
      rows=teams.map(t=>runRow(pt[t.id],t,'relay'));name=`2026_단체전_50팀_${date}.csv`;
    }else{
      rows=[...people.map(t=>runRow(pi[t.id],t,'individual')),...teams.map(t=>runRow(pt[t.id],t,'relay'))];
      name=`2026_연천피지컬_전체기록_${date}.csv`;
    }
  }
  csvDownload(name,heads,rows.map(row=>row.map(guardCsvCell)));
  notice('CSV 파일을 내려받았습니다.');
}

app.addEventListener('click',async e=>{
  const tab=e.target.closest('[data-tab]');if(tab){state.tab=tab.dataset.tab;state.search='';render();return;}
  const el=e.target.closest('[data-action]');if(!el)return;
  const action=el.dataset.action;
  try{
    switch(action){
      case 'claim':await claim();break;
      case 'release':await releaseControl();break;
      case 'start':await startRace();break;
      case 'finish':await finishRace();break;
      case 'next':stepTarget(1);break;
      case 'prev':stepTarget(-1);break;
      case 'jump':jumpTarget();break;
      case 'pick-slot':
        if(activeRun())return;
        state.selectedId=el.dataset.id;state.tab='timer';render();break;
      case 'dnf':await absentRace('dnf');break;
      case 'dsq':await absentRace('dsq');break;
      case 'export-json':exportJson();state.backupAcknowledged=true;render();notice('JSON 백업을 요청했습니다. 실제 파일 저장 여부를 확인하세요.');break;
      case 'open-reset':state.backupAcknowledged=false;state.modal='reset';render();break;
      case 'discard-stale':await discardStaleOutbox();break;
      case 'retry':await flush();notice('전송 대기열을 확인했습니다.');break;
      case 'edit-run':if(state.data.runs[el.dataset.id]?.status==='running')throw Error('진행 중 기록은 계측 화면에서 종료 처리하세요.');state.editId=el.dataset.id;state.modal='edit-run';render();break;
      case 'close-modal':state.modal='';render();break;
      case 'verify-run':await verifyRun(el.dataset.id);break;
      case 'export-results':case 'export-all':exportData('all');break;
      case 'export-people':exportData('people');break;
      case 'export-teams':exportData('teams');break;
      case 'export-history':exportData('history');break;
      case 'export-audit':exportData('audit');break;
    }
  }catch(error){notice(formatError(error),'error');}
});
app.addEventListener('submit',async e=>{
  e.preventDefault();const form=e.target;
  try{
    if(form.getAttribute('id')==='edit-run-form')await editRun(form);
    else if(form.getAttribute('id')==='reset-form')await resetRecords(form);
  }catch(error){notice(formatError(error),'error');}
});
app.addEventListener('change',async e=>{
  const el=e.target;
  if(el.id==='race-type'||el.id==='slot-type'){if(activeRun())return;state.type=el.value;state.selectedId='';chooseDefault();render();}
  else if(el.id==='target-select'){state.selectedId=el.value;render();}
  else if(el.id==='rank-type'){state.rankType=el.value;state.division='all';render();}

});
window.addEventListener('keydown',e=>{
  if(state.tab!=='timer'||state.modal||!canClock())return;
  if(['INPUT','SELECT','TEXTAREA','BUTTON'].includes(document.activeElement?.tagName))return;
  if(e.code==='Space'&&!e.repeat){e.preventDefault();void startRace();}
  if(e.code==='Enter'&&!e.repeat&&activeRun()){e.preventDefault();void finishRace();}
});
window.addEventListener('beforeunload',e=>{if(activeRun()||state.outbox.length){e.preventDefault();e.returnValue='';}});
window.addEventListener('online',()=>{if(state.cloud)void flush();});
void boot();
