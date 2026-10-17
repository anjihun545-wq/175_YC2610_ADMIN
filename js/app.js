import {firebaseConfig, EVENT_ID} from './firebase-config.js';
import {loadLocal,saveSnapshot,persistChange,removeOutbox} from './storage.js';
import {emptyData,uid,safe,msText,tsText,applyPatches,deepCopy,sortByBib,latestRuns,rankings,statusLabel,csvRows,csvDownload} from './core.js';
import {isConfigured,createCloud} from './cloud.js';

function perTabDeviceId(){
  try{let value=sessionStorage.getItem('ycps-clock-tab');if(!value){value=uid();sessionStorage.setItem('ycps-clock-tab',value);}return value;}catch{return uid();}
}
const state={
  configured:isConfigured(), cloud:null, mode:isConfigured()?'auth':'demo', role:null,user:null,connected:false,cloudLoaded:false,
  data:emptyData(), outbox:[],tab:new URLSearchParams(location.search).get('view')==='mc'?'mc':'timer',
  type:'individual', selectedId:'',rankType:'individual',division:'all', search:'', currentClock:null,
  control:false, lockPending:false, sending:false, starting:false, finishing:false, offset:0, error:'',lastBackup:0,
  deviceId:perTabDeviceId(), modal:'', editId:'', toastCount:0
};
const app=document.querySelector('#app');
const normText=x=>String(x??'').trim().slice(0,140);
const normalizeDivision=x=>({'남':'남자부','남자':'남자부','M':'남자부','남자부':'남자부','여':'여자부','여자':'여자부','F':'여자부','여자부':'여자부'})[String(x).trim()]||normText(x);
const htmlOptions=(items, value, label)=>items.map(x=>`<option value="${safe(x.id)}" ${x.id===value?'selected':''}>${safe(label(x))}</option>`).join('');
const isAdmin=()=>state.mode==='demo'||state.role==='admin';
const isViewer=()=>state.role==='viewer';
const canUse=()=>state.mode==='demo'||!!state.role;
const canClock=()=>isAdmin()&&state.control;
const list=(type)=>Object.values(state.data[type]||{});
const targets=()=>list(state.type==='individual'?'participants':'teams').sort(sortByBib);
const selected=()=>targets().find(x=>x.id===state.selectedId)||null;
const activeRun=()=>{const id=state.data.status?.current?.runId;return id?state.data.runs[id]:null;};
const modeName=t=>t==='individual'?'장애물 레이스':'4인 계주';
const entityName=(r)=>{
  if(!r)return '-';const x=state.data[r.type==='individual'?'participants':'teams']?.[r.targetId];
  return x?.name||x?.teamName||'(명단에서 삭제됨)';
};
const currentTarget=()=>{
  const r=activeRun();if(!r)return selected();
  return state.data[r.type==='individual'?'participants':'teams']?.[r.targetId]||null;
};
const escAttr=s=>safe(s);
function notice(msg,kind='normal'){
  const root=document.querySelector('.toast-stack');if(!root)return;
  const el=document.createElement('div');el.className=`toast ${kind}`;el.textContent=msg;root.append(el);
  setTimeout(()=>el.remove(),5200);
}
function connectionName(){
  if(state.mode==='demo')return ['이 기기 전용 체험','warn'];
  if(!state.connected)return ['서버 연결 끊김','bad'];
  if(state.outbox.length)return [`미전송 ${state.outbox.length}건`,'warn'];
  return ['실시간 연결 정상','ok'];
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
  const updated=applyPatches(deepCopy(state.data),patches);
  const item=state.configured?{id:uid(),createdAt:Date.now(),patches,activity}:null;
  await persistChange(updated,item);
  state.data=updated;
  if(item)state.outbox.push(item);
  render();
  if(item)void flush();
}
async function flush(){
  if(!state.cloud||!state.connected||!isAdmin()||state.sending)return;
  state.sending=true;
  try{
    while(state.outbox.length&&state.connected&&isAdmin()){
      const task=state.outbox[0];
      try{
        await state.cloud.send(task.patches); // Firebase 서버 ACK 후에만 대기열에서 삭제
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
  for(const task of state.outbox)data=applyPatches(data,task.patches);
  state.data=data;
  state.cloudLoaded=true;
  chooseDefault();
  saveSnapshot(data).catch(e=>notice(`로컬 백업 오류: ${formatError(e)}`,'error'));
  render();
}
async function boot(){
  try{
    const local=await loadLocal();state.data=Object.assign(emptyData(),local.data||{});
    state.outbox=local.queue.sort((a,b)=>a.createdAt-b.createdAt);
    chooseDefault();
  }catch(e){state.error=`기기 저장소 오류: ${formatError(e)}`;}
  render();
  if(!state.configured){state.mode='demo';state.control=true;render();return;}
  state.mode='auth';render();
  try{
    state.cloud=await createCloud({
      onIdentity:(user,role)=>{
        state.user=user;state.role=role;
        state.mode=user?'cloud':'auth';
        state.control=false;
        state.cloudLoaded=false;
        state.connected=user?state.connected:false;
        render();
        if(role==='admin')void flush();
      },
      onData:eventDataUpdate,
      onConnected:connected=>{const changed=connected!==state.connected;state.connected=connected;if(changed&&['mc','dashboard','settings'].includes(state.tab))render();else renderHeader();if(connected)void flush();},
      onServerOffset:offset=>state.offset=offset,
      onError:error=>{state.error=`Firebase 오류: ${formatError(error)}`;notice(state.error,'error');renderHeader();}
    });
  }catch(e){state.error=`Firebase 초기화 오류: ${formatError(e)}`;render();}
}
function header(){
  const [name,color]=connectionName();
  return `<header class="topbar"><div class="brand"><div class="brand-icon">Y26</div><div><div class="brand-kicker">YEONCHEON PHYSICAL SURVIVAL</div><h1>2026 연천피지컬 서바이벌</h1></div></div>
  <div class="header-right"><span id="connection-pill" class="status-pill ${color}">${safe(name)}</span>
  <span class="status-pill">${state.mode==='demo'?'LOCAL DEMO':state.role==='admin'?'운영자':state.role==='viewer'?'MC 조회':'로그인 필요'}</span>
  ${state.user?`<button class="btn sm ghost" data-action="logout">로그아웃</button>`:''}</div></header>`;
}
function renderHeader(){
  const p=document.querySelector('#connection-pill');if(!p)return;
  const [name,color]=connectionName();p.className=`status-pill ${color}`;p.textContent=name;
  const queue=document.querySelector('#queue-count');if(queue)queue.textContent=String(state.outbox.length);
}
function nav(){
  const all=isViewer()?[['mc','MC 실시간 화면'],['rank','기록·순위']]:[
    ['timer','경기 계측'],['dashboard','운영 현황'],['participants','개인 참가자'],['teams','계주 팀'],['rank','기록·순위'],['mc','MC 화면'],['settings','운영·백업']
  ];
  return `<nav class="nav">${all.map(([id,txt])=>`<button data-tab="${id}" class="${state.tab===id?'active':''}">${txt}</button>`).join('')}</nav>`;
}
function subhead(over,title,detail='',right=''){
  return `<div class="view-heading"><div><div class="overline">${safe(over)}</div><h2>${safe(title)}</h2>${detail?`<div class="muted small">${safe(detail)}</div>`:''}</div>${right}</div>`;
}
function demoBanner(){
  return state.mode==='demo'?`<div class="banner"><strong>체험 모드 · 이 기기에만 저장됩니다.</strong> Firebase 설정 전에는 다른 기기의 MC 화면에 실시간 공유되지 않습니다. 실제 행사 전 Firebase 연결이 필수입니다.</div>`:'';
}
function controlBox(){
  if(state.mode==='demo')return `<div class="info-strip">체험 모드에서는 계측 제어권이 이 기기에 있습니다. 실제 행사 운영 전 Firebase 연결 및 현장 테스트가 필요합니다.</div>`;
  return state.control?`<div class="info-strip success">이 기기가 계측 제어권을 보유 중입니다. 이 브라우저 탭을 경기 중 닫지 마세요. ${!state.connected?'(현재 오프라인: 다른 기기와 충돌할 수 있습니다.)':''}</div>`:
  `<div class="info-strip danger">계측 시작 전 이 기기에 제어권을 할당해야 합니다. 경기 중에는 **한 대의 계측 기기만** 사용하세요.</div><div class="section-gap"><button data-action="claim" class="btn primary" ${!state.connected||state.lockPending?'disabled':''}>계측 제어권 획득</button></div>`;
}
function targetDropdown(){
  const all=targets();
  const chosen=selected();
  return `<div class="target-box"><div><div class="overline">CURRENT COMPETITOR</div><div class="target-name">${chosen?safe(state.type==='individual'?`${chosen.bib}번 · ${chosen.name}`:chosen.teamName):'선택된 참가자가 없습니다'}</div>
   <div class="chips">${chosen?`<span class="chip">${safe(chosen.affiliation||'소속 없음')}</span>${state.type==='individual'?`<span class="chip">${safe(chosen.division||'부문 미정')}</span>`:'<span class="chip">4인 1팀</span>'}`:''}</div></div>
   <div class="field" style="min-width:185px"><label for="target-select">측정 대상 선택</label><select id="target-select" ${activeRun()?'disabled':''}><option value="">선택하세요</option>${htmlOptions(all,state.selectedId,t=>state.type==='individual'?`${t.bib} · ${t.name}`:`${t.teamName} (${t.members?.length||0}명)`)}</select></div></div>`;
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
  return `${subhead('RACE CONTROL','경기 계측','장애물 레이스 · 4인 계주 / 한 경기씩 순차 진행')}
    ${demoBanner()}
    <div class="layout-two"><section class="panel">
      <div class="panel-head"><h3>경기 타이머</h3><div class="chips"><span class="chip ${r?'warn':'good'}">${r?'● 경기 진행 중':'● 준비 완료'}</span><span class="chip">${state.control?'계측 제어권 보유':'제어권 필요'}</span></div></div>
      <div class="fields"><div class="field"><label>경기 종목</label><select id="race-type" ${r?'disabled':''}><option value="individual" ${state.type==='individual'?'selected':''}>장애물 레이스 · 개인전</option><option value="relay" ${state.type==='relay'?'selected':''}>4인 계주 · 팀전</option></select></div>
       <div class="field"><label>선수·팀 수</label><input readonly value="${targets().length}${state.type==='individual'?'명':'팀'} 등록" /></div></div>
      <div class="hr"></div>${r?`<div class="target-name">${safe(entityName(r))}</div><div class="small muted">${safe(modeName(r.type))} · ${tsText(r.startedAt)} 출발</div>`:targetDropdown()}
      <div class="timer-face ${r?'running':''}"><div class="overline">${r?'TIME RUNNING':'STOPWATCH'}</div><div id="live-clock" class="time">${msText(r?liveCurrentMs():done&&last.status==='finished'?last.elapsedMs:0)}</div><div class="timer-status" id="timer-status">${r?'경기가 진행 중입니다. 종료 시 즉시 기기에 저장됩니다.':done?`이전 기록: ${statusLabel(last)} / 새 경기에는 재경기 승인 필요`:'출발 신호와 동시에 시작을 누르세요.'}</div></div>
      ${needRecover?`<div class="info-strip danger">페이지가 다시 열렸습니다. 초정밀 타이머가 중단되어 이후 시간은 시스템 시각으로 추정됩니다. 이 경기의 공식 확정 전 수동 판정을 진행하세요.</div>`:''}
      <div class="action-row"><button class="action-btn start" data-action="start" ${!canClock()||r||!chosen||done?'disabled':''}>▶ 시작</button><button class="action-btn stop" data-action="finish" ${!canClock()||!r?'disabled':''}>■ 종료</button></div>
      <div class="tools section-gap"><button class="btn sm" data-action="next" ${r?'disabled':''}>다음 참가자·팀 →</button><button class="btn sm ghost" data-action="dnf" ${!canClock()||!chosen?'disabled':''}>미완주 처리</button><button class="btn sm ghost" data-action="dsq" ${!canClock()||!chosen?'disabled':''}>실격 처리</button></div>
      <div class="hr"></div>${controlBox()}
      ${state.mode==='demo'?'':`<div class="control-card section-gap"><span>서버 미전송 기록</span><b><span id="queue-count">${state.outbox.length}</span>건</b></div>`}
      <p class="notice-line">키보드 단축키: <span class="kbd">Space</span> 시작 · <span class="kbd">Enter</span> 종료. 종료 기록은 잠정 기록으로 등록됩니다. 재경기 및 수동 변경은 기록 관리에서 처리하세요.</p>
      </section>
      <aside class="stack"><section class="panel"><div class="panel-head"><h3>최근 경기기록</h3><button class="btn sm" data-tab="rank">전체 보기</button></div>
      ${previous.length?`<div class="stack">${previous.map(x=>`<div class="list-item"><div><b>${safe(entityName(x))}</b><div class="muted tiny">${safe(modeName(x.type))} · ${tsText(x.endedAt)}</div></div><div style="text-align:right"><b>${msText(x.elapsedMs)}</b><div class="tiny ${x.verified?'':'muted'}">${x.verified?'확정':'잠정'}</div></div></div>`).join('')}</div>`:'<div class="empty">아직 저장된 기록이 없습니다.</div>'}
      </section><section class="panel"><h3>현장 운영 원칙</h3><div class="notice-line">① 경기 전 계측 제어권을 획득합니다.<br/>② 시작 시 즉시 계측하고 종료 기록은 기기에 먼저 저장합니다.<br/>③ 서버 저장 완료와 공식 기록 확정은 별개의 상태입니다.<br/>④ 접전·재시작·오작동은 보조 스톱워치와 영상으로 확인합니다.</div></section></aside></div>`;
}
function dashboard(){
  const people=list('participants'),teams=list('teams');const pi=latestRuns(state.data,'individual');const pt=latestRuns(state.data,'relay');
  const completedPeople=people.filter(x=>pi[x.id]?.status==='finished').length;
  const completedTeams=teams.filter(x=>pt[x.id]?.status==='finished').length;
  const waiting=people.length-completedPeople;const r=activeRun();
  return `${subhead('OPERATIONS OVERVIEW','운영 현황','2026 연천피지컬 서바이벌 실시간 계측 현황')}${demoBanner()}
  <div class="cards"><div class="metric"><label>개인 참가자</label><strong>${people.length}</strong><small>명</small></div><div class="metric"><label>개인전 완료</label><strong>${completedPeople}</strong><small>명</small></div><div class="metric"><label>계주 등록</label><strong>${teams.length}</strong><small>팀</small></div><div class="metric"><label>계주 완료</label><strong>${completedTeams}</strong><small>팀</small></div></div>
  <div class="layout-two"><section class="panel"><div class="panel-head"><h3>현재 경기</h3><span class="badge ${r?'pending':''}">${r?'경기 진행 중':'대기 중'}</span></div>
   <div class="timer-face ${r?'running':''}"><div class="overline">${r?safe(modeName(r.type)):'READY'}</div><div class="time" id="live-clock">${msText(r?liveCurrentMs():0)}</div><div class="timer-status">${r?safe(entityName(r)):'다음 경기를 기다리고 있습니다'}</div></div>
   <div class="quick-grid"><button class="quick-card" data-tab="timer">경기 제어<strong>계측 시작 →</strong></button><button class="quick-card" data-tab="rank">순위 보기<strong>기록 확인 →</strong></button></div>
   <p class="notice-line">개인전 미완료 ${waiting}명 · 현재 서버 미전송 ${state.outbox.length}건</p></section>
  <section class="stack"><div class="panel"><h3>경기 운영 상태</h3><div class="hr"></div><div class="control-card"><span>실시간 서버</span><b>${state.mode==='demo'?'체험 모드':state.connected?'연결됨':'연결 안 됨'}</b></div><div class="control-card section-gap"><span>제어권</span><b>${state.control?'이 기기 보유':'미획득'}</b></div><div class="control-card section-gap"><span>전송 대기열</span><b>${state.outbox.length}건</b></div><div class="section-gap">${controlBox()}</div></div>
  <div class="panel"><h3>관리 메뉴</h3><div class="stack section-gap"><button class="btn" data-tab="participants">개인 명단 등록 · CSV 불러오기</button><button class="btn" data-tab="teams">4인 계주팀 등록</button><button class="btn" data-tab="settings">백업 · 네트워크 상태</button></div></div></section></div>`;
}
function participantsView(){
  const all=list('participants').sort(sortByBib).filter(x=>(`${x.bib} ${x.name} ${x.affiliation}`.toLowerCase()).includes(state.search.toLowerCase()));
  const latest=latestRuns(state.data,'individual');
  return `${subhead('PARTICIPANT MANAGEMENT','개인 참가자 관리','명단을 미리 등록하면 계측 시 참가번호로 선택할 수 있습니다.')}${demoBanner()}
  <div class="layout-two"><section class="panel"><div class="panel-head"><h3>개인 명단 <span class="muted">(${list('participants').length}명)</span></h3><button class="btn sm" data-action="download-individual-template">CSV 양식</button></div>
  <div class="tools"><input id="people-search" placeholder="참가번호 / 이름 / 소속 검색" value="${safe(state.search)}" style="flex:1;min-width:160px"/><label class="btn sm" for="csv-people">CSV 일괄 등록</label><input id="csv-people" type="file" accept=".csv,text/csv" hidden/></div>
  <div class="table-wrap section-gap"><table><thead><tr><th>번호</th><th>이름</th><th>구분</th><th>소속</th><th>상태</th><th></th></tr></thead><tbody>${all.map(x=>`<tr><td>${safe(x.bib)}</td><td><b>${safe(x.name)}</b></td><td>${safe(x.division)}</td><td>${safe(x.affiliation||'-')}</td><td>${statusLabel(latest[x.id])}</td><td><button class="btn sm" data-action="edit-person" data-id="${safe(x.id)}">수정</button></td></tr>`).join('')||'<tr><td colspan="6" class="empty">등록된 참가자가 없습니다.</td></tr>'}</tbody></table></div></section>
  <section class="panel"><h3 id="person-title">개인 참가자 등록</h3><form id="person-form" class="stack section-gap"><input name="id" type="hidden" value=""/><div class="field"><label>참가번호 *</label><input name="bib" required maxlength="30" placeholder="예: 001" /></div><div class="field"><label>이름 *</label><input name="name" required maxlength="70" placeholder="예: 김철수" /></div>
  <div class="field"><label>참가 부문</label><select name="division"><option value="남자부">남자부</option><option value="여자부">여자부</option><option value="기타">기타</option></select></div><div class="field"><label>소속</label><input name="affiliation" maxlength="100" placeholder="부대 / 소속 (선택)" /></div>
  <button type="submit" class="btn primary fill">참가자 저장</button><button type="button" class="btn ghost fill" data-action="clear-person">새 참가자 입력</button></form></section></div>`;
}
function teamsView(){
  const all=list('teams').sort((a,b)=>String(a.teamName).localeCompare(String(b.teamName),'ko'));
  const latest=latestRuns(state.data,'relay');
  return `${subhead('RELAY TEAMS','4인 계주팀 관리','1팀 4명 · 한 번에 1팀만 출발합니다.')}${demoBanner()}
  <div class="layout-two"><section class="panel"><div class="panel-head"><h3>계주팀 명단 <span class="muted">(${all.length}팀)</span></h3><button class="btn sm" data-action="download-team-template">CSV 양식</button></div>
   <div class="tools"><label class="btn sm" for="csv-teams">CSV 일괄 등록</label><input type="file" id="csv-teams" accept=".csv,text/csv" hidden/></div>
   <div class="table-wrap section-gap"><table><thead><tr><th>팀명</th><th>4명 주자</th><th>소속</th><th>상태</th><th></th></tr></thead><tbody>${all.map(t=>`<tr><td><b>${safe(t.teamName)}</b></td><td>${safe((t.members||[]).join(' / '))}</td><td>${safe(t.affiliation||'-')}</td><td>${statusLabel(latest[t.id])}</td><td><button class="btn sm" data-action="edit-team" data-id="${safe(t.id)}">수정</button></td></tr>`).join('')||'<tr><td colspan="5" class="empty">등록된 팀이 없습니다.</td></tr>'}</tbody></table></div></section>
   <section class="panel"><h3>계주팀 등록</h3><form id="team-form" class="stack section-gap"><input name="id" type="hidden" value=""/><div class="field"><label>팀명 *</label><input name="teamName" required maxlength="80" placeholder="예: A팀" /></div><div class="field"><label>소속</label><input name="affiliation" maxlength="100" placeholder="예: 연천 체육회" /></div>
   ${[1,2,3,4].map(i=>`<div class="field"><label>${i}주자 이름 *</label><input name="member${i}" maxlength="70" required placeholder="${i}주자" /></div>`).join('')}
   <button type="submit" class="btn primary fill">계주팀 저장</button><button type="button" class="btn ghost fill" data-action="clear-team">새 팀 입력</button></form></section></div>`;
}
function rankAt(rows,i){return rows.findIndex(x=>x.run.elapsedMs===rows[i].run.elapsedMs)+1;}
function badgeFor(r){
  const label=statusLabel(r),c=label==='확정'?'':label==='실격'||label==='미완주'?'danger':'pending';
  return `<span class="badge ${c}">${label}</span>`;
}
function rankView(){
  const rows=rankings(state.data,state.rankType,state.division);const top=rows.slice(0,3);
  const allLast=latestRuns(state.data,state.rankType);
  const others=Object.values(state.rankType==='individual'?state.data.participants:state.data.teams).filter(t=>state.division==='all'||t.division===state.division).filter(t=>!rows.some(x=>x.id===t.id)).sort(sortByBib);
  return `${subhead('LIVE RESULTS','기록·순위','종료 즉시 잠정 순위에 반영되며 확정 기록은 별도로 구분됩니다.')}${demoBanner()}
  <div class="panel"><div class="fields"><div class="field"><label>경기 종목</label><select id="rank-type"><option value="individual" ${state.rankType==='individual'?'selected':''}>개인 장애물 레이스</option><option value="relay" ${state.rankType==='relay'?'selected':''}>4인 계주경기</option></select></div><div class="field"><label>참가 구분</label><select id="rank-division"><option value="all">전체</option>${state.rankType==='individual'?['남자부','여자부','기타'].map(x=>`<option value="${x}" ${state.division===x?'selected':''}>${x}</option>`).join(''):''}</select></div></div>
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
  const stale=r && current?.heartbeatAt && Date.now()-current.heartbeatAt>30000;
  const im=rankings(state.data,'individual','남자부').slice(0,5);const iw=rankings(state.data,'individual','여자부').slice(0,5);const tr=rankings(state.data,'relay').slice(0,5);
  return `<div class="mc-header"><div class="overline">OFFICIAL LIVE SCOREBOARD</div><h1>2026 연천피지컬 서바이벌</h1><p class="muted">MC · 진행본부 실시간 기록 조회</p></div>
   ${demoBanner()}
   ${state.mode!=='demo'&&!state.connected?'<div class="banner red">서버 연결이 끊겼습니다. 화면의 기록은 최신 정보가 아닐 수 있습니다.</div>':''}
   <div class="mc-clock"><div class="overline">${r?safe(modeName(r.type)):'NOW READY'}</div><h2>${r?safe(entityName(r)):'다음 경기를 준비합니다'}</h2><div class="time" id="live-clock">${r?msText(Math.max(0,Date.now()+state.offset-r.startedAt)): '00:00.00'}</div>
   <span class="badge ${r?'pending':''}">${r?(stale?'계측기 통신 지연 · 시간 참고용':'현재 경기 진행 중 · 시간 참고용'):'경기 대기'}</span>
   <div class="notice-line">진행 중 표시 시간은 참고용입니다. 공식 기록은 계측 기기의 종료 기록을 기준으로 합니다.</div></div>
   <div class="mc-grid section-gap">${[[im,'장애물 남자부 TOP 5'],[iw,'장애물 여자부 TOP 5'],[tr,'4인 계주 TOP 5']].map(([rows,name])=>`<section class="panel"><div class="panel-head"><h3>${name}</h3><span class="badge">실시간 자동 반영</span></div>
     <div class="stack">${rows.length?rows.map((x,i)=>`<div class="list-item"><div class="pill-row"><span class="rank">${rankAt(rows,i)}</span><div><b>${safe(x.name||x.teamName)}</b><div class="small muted">${safe(x.division||'계주')}</div></div></div><div style="text-align:right"><strong>${msText(x.run.elapsedMs)}</strong><div class="tiny muted">${x.run.verified?'확정':'잠정'}</div></div></div>`).join(''):'<div class="empty">경기 종료 기록을 기다리고 있습니다.</div>'}</div></section>`).join('')}</div>
  <div class="footer"><span>기록을 직접 조작할 수 없는 조회 화면입니다.</span><span>네트워크 상태: ${state.mode==='demo'?'체험 모드':state.connected?'연결 정상':'연결 끊김'}</span></div>`;
}
function settingsView(){
  const audits=Object.values(state.data.audit||{}).sort((a,b)=>b.at-a.at).slice(0,25);
  return `${subhead('CONTROL & BACKUP','운영·백업 설정','기록 안전성과 행사 전 점검을 위한 메뉴')}${demoBanner()}
   <div class="layout-two"><section class="stack"><div class="panel"><h3>저장 및 연결 상태</h3><div class="stack section-gap">
     <div class="control-card"><span>Firebase 설정</span><b>${state.configured?'설정됨':'미설정 · 체험 모드'}</b></div>
     <div class="control-card"><span>연결 상태</span><b>${state.mode==='demo'?'로컬 전용':state.connected?'온라인':'오프라인'}</b></div>
     <div class="control-card"><span>서버 미전송</span><b id="queue-count">${state.outbox.length}</b></div>
     <div class="control-card"><span>계측 제어권</span><b>${state.control?'이 기기 보유':'미보유'}</b></div>
   </div><div class="tools section-gap"><button class="btn" data-action="retry" ${!state.connected||!state.outbox.length?'disabled':''}>미전송 기록 재전송</button>${state.mode!=='demo'?`<button class="btn" data-action="claim" ${!isAdmin()||!state.connected?'disabled':''}>제어권 갱신</button><button class="btn ghost" data-action="release" ${!state.control?'disabled':''}>제어권 반납</button>`:''}</div>
   ${state.error?`<div class="banner red">${safe(state.error)}</div>`:''}</div>
   <div class="panel"><h3>결과 자료 백업</h3><p class="notice-line">CSV 파일은 Excel에서 열 수 있습니다. 실제 행사 기록은 별도의 PC와 USB에도 백업하는 것을 권장합니다.</p>
   <div class="stack section-gap"><button class="btn primary" data-action="export-all">전체 기록 CSV 내려받기</button><button class="btn" data-action="export-people">개인 참가자 명단 CSV</button><button class="btn" data-action="export-teams">계주팀 명단 CSV</button><button class="btn" data-action="export-history">전체 계측 시도 이력 CSV</button><button class="btn" data-action="export-audit">수정 이력 CSV</button></div></div></section>
   <section class="panel"><h3>기록 변경 이력</h3><div class="stack section-gap">${audits.length?audits.map(x=>`<div class="list-item"><div><b>${safe(x.action)}</b><div class="muted tiny">${safe(x.detail||'')}</div><div class="muted tiny">${tsText(x.at)}</div></div><span class="chip">${safe(x.actor||'LOCAL')}</span></div>`).join(''):'<div class="empty">아직 수정 이력이 없습니다.</div>'}</div></section></div>`;
}
function loginView(){
  return `<div class="login-wrap"><div class="panel"><div class="overline">SECURE LOGIN</div><h2>운영자 · MC 로그인</h2><p class="small muted">Firebase 계정으로 로그인합니다. 계측·기록 변경은 운영자만 가능합니다.</p>
   ${state.error?`<div class="banner red">${safe(state.error)}</div>`:''}
   ${state.user&&state.role!=='admin'&&state.role!=='viewer'?`<div class="banner">계정 로그인은 성공했지만 접근 권한이 없습니다. Firebase Realtime Database의 roles/${safe(state.user.uid)}에 admin 또는 viewer를 지정해야 합니다.<p class="small">UID: <code>${safe(state.user.uid)}</code></p></div>`:''}
   <form id="login-form"><div class="field"><label>계정 이메일</label><input type="email" name="email" autocomplete="username" required/></div><div class="field"><label>비밀번호</label><input type="password" name="password" autocomplete="current-password" required/></div><button class="btn primary section-gap" type="submit">로그인</button></form>
   <div class="notice-line">계정은 Firebase Authentication에서 미리 등록해야 합니다. 자세한 방법은 함께 제공한 SETUP_GUIDE.md를 확인하세요.</div></div></div>`;
}
function modalHtml(){
  if(!state.modal)return '';
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
  const roleDenied=state.configured&&!canUse();
  const body=roleDenied?loginView():(({
    timer:timerView,dashboard,participants:participantsView,teams:teamsView,rank:rankView,mc:mcView,settings:settingsView
  })[isViewer()&&!['rank','mc'].includes(state.tab)?'mc':state.tab]||timerView)();
  app.innerHTML=`<div class="app-shell">${header()}${roleDenied?'':nav()}<main>${body}</main>${roleDenied?'':`<footer class="footer"><span>2026 연천피지컬 서바이벌 · 경기 기록관리 v1.0</span><span>기록은 공식 승인 전 잠정 결과입니다.</span></footer>`}</div>${modalHtml()}<div class="toast-stack" role="status" aria-live="polite"></div>`;
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
    if(r&&!state.outbox.length)await state.cloud.send({'status/current/heartbeatAt':Date.now()});
  }catch(e){state.error=`계측 제어권 갱신 실패: ${formatError(e)}`;renderHeader();}
},10000);

async function claim(){
  if(state.mode==='demo'){state.control=true;render();return;}
  if(!isAdmin()||!state.connected||!state.cloud)return notice('로그인 및 온라인 연결이 필요합니다.','error');
  state.lockPending=true;render();
  try{state.control=await state.cloud.claim(state.deviceId);notice(state.control?'계측 제어권을 획득했습니다.':'다른 기기에서 이미 계측 중입니다.',state.control?'good':'error');}
  catch(e){notice(formatError(e),'error');}finally{state.lockPending=false;render();}
}
async function releaseControl(){
  if(activeRun())return notice('진행 중 경기를 종료한 후 반납하세요.','error');
  try{if(state.cloud&&state.connected)await state.cloud.release(state.deviceId);state.control=false;notice('계측 제어권을 반납했습니다.');render();}
  catch(e){notice(formatError(e),'error');}
}
function nextTarget(){
  const all=targets();if(!all.length)return;
  const i=all.findIndex(x=>x.id===state.selectedId);
  state.selectedId=all[(i+1)%all.length].id;render();
}
async function startRace(){
  if(!canClock())return notice('계측 제어권이 필요합니다.','error');
  if(state.starting||activeRun())return notice('이미 진행 중이거나 시작 처리 중인 경기가 있습니다.','error');
  const t=selected();if(!t)return notice('선수 또는 팀을 선택하세요.','error');
  const prev=latestFor(state.type,t.id);
  if(prev && prev.status!=='cancelled')return notice('이미 기록이 있습니다. 기록 관리에서 기존 기록을 취소해야 재경기할 수 있습니다.','error');
  if(state.type==='relay'&&t.members?.length!==4)return notice('계주는 반드시 4명의 주자가 있어야 합니다.','error');
  state.starting=true;
  const mark=performance.now(),now=Date.now();
  const id=`run_${uid().replaceAll('-','')}`;
  const run={id,type:state.type,targetId:t.id,startedAt:now,endedAt:null,elapsedMs:null,status:'running',verified:false,accuracy:'monotonic',createdBy:state.user?.uid||'local',updatedAt:now};
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
    // 다음 대기자로 이동하되 마지막 기록은 우측 최근 기록에 표시됩니다.
    const all=targets();const done=latestRuns(state.data,r.type);
    const next=all.find(x=>!done[x.id]||done[x.id].status==='cancelled');if(next)state.selectedId=next.id;
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
  const r={id,type:state.type,targetId:t.id,startedAt:now,endedAt:now,elapsedMs:null,status,verified:false,accuracy:'manual',createdBy:state.user?.uid||'local',updatedAt:now};
  await commit({[`runs/${id}`]:r},status);
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
async function savePerson(form){
  const d=new FormData(form);const id=normText(d.get('id'))||`p_${uid().replaceAll('-','')}`;
  const bib=normText(d.get('bib')),name=normText(d.get('name')),division=normalizeDivision(d.get('division')),affiliation=normText(d.get('affiliation'));
  if(!bib||!name)throw Error('번호와 이름을 모두 입력하세요.');
  if(list('participants').some(x=>x.bib===bib&&x.id!==id))throw Error('동일한 참가번호가 이미 등록되어 있습니다.');
  await auditChange({[`participants/${id}`]:{id,bib,name,division,affiliation}},'개인 참가자 저장',`${bib} ${name}`);
  notice('참가자를 저장했습니다.','good');render();
}
async function saveTeam(form){
  const d=new FormData(form);const id=normText(d.get('id'))||`t_${uid().replaceAll('-','')}`;
  const teamName=normText(d.get('teamName'));const affiliation=normText(d.get('affiliation'));
  const members=[1,2,3,4].map(i=>normText(d.get(`member${i}`)));
  if(!teamName||members.some(v=>!v))throw Error('팀명과 주자 4명을 입력하세요.');
  if(list('teams').some(x=>x.teamName===teamName&&x.id!==id))throw Error('같은 팀명이 있습니다.');
  await auditChange({[`teams/${id}`]:{id,teamName,affiliation,members}},'계주팀 저장',teamName);
  notice('계주팀을 저장했습니다.','good');render();
}
async function importCsv(file,type){
  if(!isAdmin())throw Error('운영자만 명단을 등록할 수 있습니다.');
  const rows=csvRows(await file.text());if(rows.length<2)throw Error('CSV 파일이 비었거나 헤더가 없습니다.');
  if(rows.length>1501)throw Error('한 번에 최대 1,500개 항목까지 등록할 수 있습니다.');
  const headers=rows.shift().map(x=>x.replaceAll(' ','').trim());
  const val=(row,name)=>row[headers.indexOf(name)]?.trim()||'';
  const patches={};let inserted=0;
  if(type==='individual'){
    const existing=list('participants');
    const seen=new Set();
    for(const [i,row] of rows.entries()){
      const bib=val(row,'번호')||val(row,'참가번호'),name=val(row,'이름'),division=val(row,'성별')||val(row,'구분')||'남자부',affiliation=val(row,'소속');
      if(!bib||!name)throw Error(`${i+2}행 번호 또는 이름이 비어 있습니다.`);
      if(seen.has(bib))throw Error(`${i+2}행 참가번호 ${bib} 중복`);
      seen.add(bib);
      const old=existing.find(x=>x.bib===bib);const id=old?.id||`p_${uid().replaceAll('-','')}`;
      patches[`participants/${id}`]={id,bib:normText(bib),name:normText(name),division:normalizeDivision(division),affiliation:normText(affiliation)};inserted++;
    }
  }else{
    const existing=list('teams');const seen=new Set();
    for(const [i,row] of rows.entries()){
      const teamName=val(row,'팀명'),affiliation=val(row,'소속');const members=[1,2,3,4].map(j=>val(row,`주자${j}`));
      if(!teamName||members.some(x=>!x))throw Error(`${i+2}행 팀명 또는 주자 4명이 누락되었습니다.`);
      if(seen.has(teamName))throw Error(`${i+2}행 팀명 중복`);seen.add(teamName);
      const old=existing.find(x=>x.teamName===teamName),id=old?.id||`t_${uid().replaceAll('-','')}`;
      patches[`teams/${id}`]={id,teamName:normText(teamName),affiliation:normText(affiliation),members:members.map(normText)};inserted++;
    }
  }
  if(!inserted)throw Error('등록할 항목이 없습니다.');
  if(!confirm(`${inserted}개 항목을 저장할까요? 동일한 번호·팀명은 정보가 갱신됩니다.`))return;
  await auditChange(patches,'CSV 명단 일괄 등록',`${type==='individual'?'개인':'계주'} ${inserted}건`);
  notice(`${inserted}건을 등록했습니다.`, 'good');
}
function guardCsvCell(s){const t=String(s??'');return /^[=+@\-\t\r]/.test(t)?`'${t}`:t;}
function exportData(kind){
  const date=new Date().toISOString().slice(0,10);
  const people=list('participants').sort(sortByBib),team=list('teams');
  const allRuns=Object.values(state.data.runs).sort((a,b)=>(a.startedAt||0)-(b.startedAt||0));
  let heads,rows,name;
  if(kind==='people'||kind==='people-template'){
    heads=['번호','이름','성별','소속'];rows=kind==='people-template'?[['001','홍길동','남자부','연천군'],['002','김영희','여자부','연천군']]:people.map(p=>[p.bib,p.name,p.division,p.affiliation]);name=`개인참가자_${date}.csv`;
  }else if(kind==='teams'||kind==='teams-template'){
    heads=['팀명','주자1','주자2','주자3','주자4','소속'];rows=kind==='teams-template'?[['A팀','선수1','선수2','선수3','선수4','연천군']]:team.map(t=>[t.teamName,...(t.members||[]),t.affiliation]);name=`계주팀_${date}.csv`;
  }else if(kind==='audit'){
    heads=['일시','작업','내용','작업자'];rows=Object.values(state.data.audit).map(a=>[tsText(a.at),a.action,a.detail,a.actor]);name=`기록변경이력_${date}.csv`;
  }else{
    heads=['종목','참가번호','참가자 또는 팀','성별·부문','기록(초)','상태','승인','측정 방식','출발시각','종료시각'];
    const runRow=(r,t,type)=>[modeName(type),t.bib||'',t.name||t.teamName||'',t.division||'계주',r?.elapsedMs==null?'':(r.elapsedMs/1000).toFixed(2),statusLabel(r),r?.verified?'확정':'미확정',r?.accuracy||'',tsText(r?.startedAt),tsText(r?.endedAt)];
    if(kind==='history'){rows=allRuns.map(r=>runRow(r,state.data[r.type==='individual'?'participants':'teams'][r.targetId]||{},r.type));name=`2026_연천피지컬_계측이력_${date}.csv`;}
    else{const pi=latestRuns(state.data,'individual'),rt=latestRuns(state.data,'relay');rows=[...people.map(t=>runRow(pi[t.id],t,'individual')),...team.map(t=>runRow(rt[t.id],t,'relay'))];name=`2026_연천피지컬_전체기록_${date}.csv`;}
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
      case 'next':nextTarget();break;
      case 'dnf':await absentRace('dnf');break;
      case 'dsq':await absentRace('dsq');break;
      case 'logout':await state.cloud.logout();break;
      case 'retry':await flush();notice('전송 대기열을 확인했습니다.');break;
      case 'edit-person':{
        const t=state.data.participants[el.dataset.id],form=document.getElementById('person-form');if(!t||!form)return;
        for(const k of ['id','bib','name','division','affiliation'])form.elements[k].value=t[k]||'';
        document.getElementById('person-title').textContent='개인 참가자 수정';form.scrollIntoView({behavior:'smooth',block:'center'});break;
      }
      case 'clear-person':document.getElementById('person-form')?.reset();document.getElementById('person-form').elements.id.value='';document.getElementById('person-title').textContent='개인 참가자 등록';break;
      case 'edit-team':{
        const t=state.data.teams[el.dataset.id],form=document.getElementById('team-form');if(!t||!form)return;
        for(const k of ['id','teamName','affiliation'])form.elements[k].value=t[k]||'';
        for(let i=1;i<=4;i++)form.elements[`member${i}`].value=t.members[i-1]||'';
        form.scrollIntoView({behavior:'smooth',block:'center'});break;
      }
      case 'clear-team':document.getElementById('team-form')?.reset();document.getElementById('team-form').elements.id.value='';break;
      case 'edit-run':if(state.data.runs[el.dataset.id]?.status==='running')throw Error('진행 중 기록은 계측 화면에서 종료 처리하세요.');state.editId=el.dataset.id;state.modal='edit-run';render();break;
      case 'close-modal':state.modal='';render();break;
      case 'verify-run':await verifyRun(el.dataset.id);break;
      case 'download-individual-template':exportData('people-template');break;
      case 'download-team-template':exportData('teams-template');break;
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
    if(form.getAttribute('id')==='login-form'){
      if(!state.cloud)throw Error('Firebase가 아직 준비되지 않았습니다.');
      const d=new FormData(form);await state.cloud.login(String(d.get('email')).trim(),String(d.get('password')));notice('로그인 확인 중입니다.');
    }else if(form.getAttribute('id')==='person-form')await savePerson(form);
    else if(form.getAttribute('id')==='team-form')await saveTeam(form);
    else if(form.getAttribute('id')==='edit-run-form')await editRun(form);
  }catch(error){notice(formatError(error),'error');}
});
app.addEventListener('change',async e=>{
  const el=e.target;
  if(el.id==='race-type'){state.type=el.value;state.selectedId='';chooseDefault();render();}
  else if(el.id==='target-select'){state.selectedId=el.value;render();}
  else if(el.id==='rank-type'){state.rankType=el.value;state.division='all';render();}
  else if(el.id==='rank-division'){state.division=el.value;render();}
  else if(el.id==='csv-people'||el.id==='csv-teams'){
    try{const file=el.files?.[0];if(file)await importCsv(file,el.id==='csv-people'?'individual':'relay');}
    catch(err){notice(formatError(err),'error');}
    el.value='';
  }
});
app.addEventListener('input',e=>{
  if(e.target.id==='people-search'){
    state.search=e.target.value;
    // 입력 포커스를 유지하기 위해 테이블 부분만 갱신하는 대신 짧게 대기 후 렌더
    const value=state.search,cursor=e.target.selectionStart;
    render();const input=document.querySelector('#people-search');if(input){input.focus();input.setSelectionRange(cursor,cursor);}
  }
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
