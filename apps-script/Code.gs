/**
 * 2026 연천피지컬 서바이벌 v1.5 — Apps Script server
 *
 * 설치: 새 Google 스프레드시트 > 확장 프로그램 > Apps Script > 이 코드 붙여넣기.
 * 실행: setup() 1회 실행해 권한 승인 > 배포(웹 앱, 나로 실행, 액세스 권한 모든 사용자).
 * 보안: 로그인 없는 배포는 주소가 알려지면 누구든 결과를 바꿀 수 있습니다.
 *
 * 읽기 JSONP / 쓰기 숨겨진 iframe form POST / 저장 성공은 다음 조회의 ack로 확인.
 */
var YC_EVENT = 'yeoncheon-physical-2026';
var YC_CHUNK = 25000; // Google Sheet 셀 50,000자 한도보다 충분히 작게
var YC_KEEP_ACKS = 350;
var YC_LEASE_MS = 50000;

function setup(){
  var lk=LockService.getScriptLock();lk.waitLock(25000);
  try{
    var ss=ycSpreadsheet_();
    ycEnsure_(ss);
    var state=ycLoad_(ss);
    ycRebuildResults_(ss,state);
    Logger.log('Ready. spreadsheet=' + ss.getUrl() + ', generation=' + ycGen_(state));
    return 'READY: '+ss.getUrl();
  }finally{lk.releaseLock();}
}
function doGet(e){
  var p=(e&&e.parameter)||{};
  try{
    var action=String(p.action||'state');
    if(action==='ping')return ycText_({ok:true,service:'YC2026 Apps Script v1.5',time:Date.now()});
    if(action!=='state'||p.event!==YC_EVENT)throw Error('잘못된 조회 요청입니다.');
    var lk=LockService.getScriptLock();lk.waitLock(12000);
    var state;
    try{var ss=ycSpreadsheet_();ycEnsure_(ss);state=ycLoad_(ss);}finally{lk.releaseLock();}
    // 이 응답은 익명 방문자에게 공개됩니다. 개인정보를 데이터베이스에 저장하지 마세요.
    var response={ok:true,serverTime:Date.now(),data:state};
    if(p.callback)return ycJsonp_(String(p.callback),response);
    return ycText_(response);
  }catch(err){
    var failure={ok:false,error:String(err&&err.message||err)};
    try{if(p.callback)return ycJsonp_(String(p.callback),failure);}catch(ignored){}
    return ycText_(failure);
  }
}
function doPost(e){
  // 외부 GitHub 사이트의 form POST. ContentService 응답은 브라우저에서 직접 읽지 않습니다.
  try{
    var raw=e&&e.parameter&&e.parameter.payload;
    if(!raw||raw.length>55000)throw Error('요청 본문이 비어 있거나 너무 큽니다.');
    var req=JSON.parse(raw);
    var answer=ycExecute_(req);
    return ycText_({ok:true,requestId:answer});
  }catch(err){
    console.error('YC doPost: '+String(err));
    return ycText_({ok:false,error:String(err&&err.message||err)});
  }
}
function ycExecute_(req){
  if(!req||req.event!==YC_EVENT)throw Error('잘못된 대회 식별자입니다.');
  var id=String(req.id||'');
  if(!/^[A-Za-z0-9_-]{6,100}$/.test(id))throw Error('잘못된 요청 ID입니다.');
  var lk=LockService.getScriptLock();lk.waitLock(25000);
  try{
    var ss=ycSpreadsheet_();ycEnsure_(ss);
    var state=ycLoad_(ss);
    if(!state.acks)state.acks={};
    if(state.acks[id])return id; // 이미 처리한 요청: 중복 저장 / 초기화 차단
    var command=String(req.command||'');
    var result=null;
    try{
      if(command==='mutation') result=ycMutation_(state,req);
      else if(command==='claim') result=ycClaim_(state,req);
      else if(command==='release') result=ycRelease_(state,req);
      else if(command==='reset') result=ycReset_(state,req);
      else throw Error('지원하지 않는 명령입니다.');
      state.acks[id]={ok:true,at:Date.now(),result:result||{}};
    }catch(err){
      state.acks[id]={ok:false,at:Date.now(),error:String(err&&err.message||err).slice(0,300)};
    }
    var keys=Object.keys(state.acks);
    if(keys.length>YC_KEEP_ACKS){
      keys.sort(function(a,b){return Number(state.acks[a].at||0)-Number(state.acks[b].at||0);});
      keys.slice(0,keys.length-YC_KEEP_ACKS).forEach(function(k){delete state.acks[k];});
    }
    ycSave_(ss,state);
    // 사람도 읽을 수 있도록 별도 결과표를 갱신합니다. 원본 저장에는 영향 주지 않습니다.
    try{if(state.acks[id].ok)ycUpdateResults_(ss,state,command,req);}catch(summaryErr){console.warn("요약표 갱신 지연: "+summaryErr);}
    return id;
  }finally{lk.releaseLock();}
}
function ycMutation_(state,req){
  if(Number(req.generation)!==ycGen_(state))throw Error('초기화 이전 버전의 기록입니다. 자동 등록을 차단했습니다.');
  if(!req.patches||typeof req.patches!=='object'||Array.isArray(req.patches))throw Error('잘못된 기록 데이터');
  var patches=req.patches, keys=Object.keys(patches);
  if(keys.length<1||keys.length>8)throw Error('비정상적인 변경 개수');
  var lease=state.clockLock;
  if(!lease||lease.owner!==String(req.deviceId||'')||Number(lease.until)<Date.now()){
    // 오프라인 중 정상 완주한 기록을 재연결 시 받을 수 있도록, 기록을 시작한 기기만 예외 허용
    var isFinish=keys.some(function(k){return /^runs\/run_[A-Za-z0-9_-]+$/.test(k)&&patches[k]&&patches[k].status!=='running';});
    var ownRun=isFinish&&keys.some(function(k){return /^runs\/run_[A-Za-z0-9_-]+$/.test(k)&&state.runs&&state.runs[k.split('/')[1]]&&state.runs[k.split('/')[1]].deviceId===String(req.deviceId||'');});
    if(!ownRun)throw Error('이 기기에 유효한 계측 제어권이 없습니다.');
  }
  // 상태 오브젝트와 기록/수정 이력 키만 허용합니다. 서버 설정이나 기초 번호 수정 불가.
  keys.forEach(function(path){
    if(!(/^runs\/run_[A-Za-z0-9_-]+$/.test(path)||/^audit\/audit_[A-Za-z0-9_-]+$/.test(path)||path==='status/current'||path==='status/current/heartbeatAt'))
      throw Error('변경할 수 없는 경로: '+path);
    var val=patches[path];
    if(val!==null && JSON.stringify(val).length>6000)throw Error('기록 크기가 너무 큽니다.');
  });
  // run이 running으로 시작하는 경우 현재 시작 중인 기록이 없어야 합니다.
  keys.forEach(function(path){
    if(/^runs\//.test(path)&&patches[path]&&patches[path].status==='running'){
      if(state.status&&state.status.current)throw Error('이미 경기 중입니다.');
      if(patches[path].deviceId!==String(req.deviceId||''))throw Error('계측 기기 ID가 일치하지 않습니다.');
      var r=patches[path];
      if(!['individual','relay'].includes(r.type)||!/^([pt])_\d{2,3}$/.test(r.targetId))throw Error('잘못된 종목 또는 번호입니다.');
      var bib=Number(r.targetId.slice(2));
      if(r.type==='individual'&&(bib<1||bib>200||!/^p_\d{3}$/.test(r.targetId)))throw Error('개인전 번호 범위 오류');
      if(r.type==='relay'&&(bib<1||bib>50||!/^t_\d{2}$/.test(r.targetId)))throw Error('단체전 번호 범위 오류');
    }
  });
  keys.forEach(function(path){ycApply_(state,path,patches[path]);});
  state.meta=state.meta||{};
  state.meta.revision=Number(state.meta.revision||0)+1;
  state.meta.updatedAt=Date.now();
  return {revision:state.meta.revision};
}
function ycClaim_(state,req){
  var dev=String(req.deviceId||'');if(!/^[A-Za-z0-9_-]{6,100}$/.test(dev))throw Error('기기 식별 오류');
  var lock=state.clockLock;
  var now=Date.now();
  if(!lock||lock.owner===dev||Number(lock.until)<now){
    state.clockLock={owner:dev,until:now+YC_LEASE_MS,updatedAt:now};
    return {claimed:true};
  }
  return {claimed:false};
}
function ycRelease_(state,req){
  if(state.clockLock&&state.clockLock.owner===String(req.deviceId||''))state.clockLock=null;
  return {released:true};
}
function ycReset_(state,req){
  var scope=String(req.scope||'');
  if(!['individual','relay','all'].includes(scope))throw Error('잘못된 초기화 범위');
  if(Number(req.generation)!==ycGen_(state))throw Error('다른 기기에서 초기화된 이후의 요청입니다.');
  if(state.status&&state.status.current)throw Error('진행 중인 경기를 먼저 종료하세요.');
  var runs=state.runs||{};
  if(scope==='all'){state.runs={};state.audit={};}
  else{
    Object.keys(runs).forEach(function(id){if(runs[id]&&runs[id].type===scope)delete runs[id];});
  }
  state.status={current:null};
  state.clockLock=null;
  state.meta=state.meta||{};
  state.meta.generation=ycGen_(state)+1;
  state.meta.revision=Number(state.meta.revision||0)+1;
  state.meta.resetAt=Date.now();state.meta.resetScope=scope;
  var aud='audit_'+Utilities.getUuid().replace(/-/g,'');
  state.audit=state.audit||{};
  state.audit[aud]={id:aud,action:'기록 초기화',detail:'범위: '+scope,at:Date.now(),actor:'APPS_SCRIPT'};
  return {reset:true,generation:state.meta.generation};
}
function ycApply_(root,path,value){
  var bits=path.split('/'),parent=root;
  for(var i=0;i<bits.length-1;i++)parent=parent[bits[i]]||(parent[bits[i]]={});
  if(value===null)delete parent[bits[bits.length-1]];
  else parent[bits[bits.length-1]]=JSON.parse(JSON.stringify(value));
}
function ycGen_(state){return Number(state.meta&&state.meta.generation||0);}
function ycBlank_(){return {runs:{},audit:{},status:{current:null},clockLock:null,meta:{generation:0,revision:0},acks:{}};}
function ycSpreadsheet_(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  if(!ss)throw Error('스프레드시트에서 [확장 프로그램 > Apps Script]를 통해 만드세요.');
  return ss;
}
function ycEnsure_(ss){
  ['YC_META','YC_STATE_A','YC_STATE_B','YC_RESULTS'].forEach(function(n){if(!ss.getSheetByName(n))ss.insertSheet(n);});
  var display=ss.getSheetByName('YC_RESULTS');
  if(!display.getRange(1,1).getValue())ycRebuildResults_(ss,ycBlank_());
  var meta=ss.getSheetByName('YC_META');
  if(!meta.getRange(1,1).getValue()){
    var start=JSON.stringify(ycBlank_());
    ss.getSheetByName('YC_STATE_A').getRange(1,1).setValue(start);
    meta.getRange(1,1,1,3).setValues([['A',1,Date.now()]]);
    SpreadsheetApp.flush();
  }
}
function ycLoad_(ss){
  var meta=ss.getSheetByName('YC_META');
  var col=String(meta.getRange(1,1).getValue()||'A');
  var count=Number(meta.getRange(1,2).getValue()||1);
  if(!['A','B'].includes(col)||count<1||count>100)throw Error('저장소 메타데이터 손상');
  var sh=ss.getSheetByName('YC_STATE_'+col);
  var parts=sh.getRange(1,1,count,1).getValues().map(function(r){return String(r[0]||'');});
  var content=parts.join('');
  if(!content)throw Error('서버 기록을 읽을 수 없습니다.');
  var parsed=JSON.parse(content);
  if(!parsed||typeof parsed!=='object')throw Error('서버 기록 JSON 오류');
  return parsed;
}
function ycSave_(ss,state){
  // 2개 슬롯의 번갈아쓰기: 저장 중 오류가 나면 메타 포인터를 바꾸지 않아 이전 상태 보존
  var meta=ss.getSheetByName('YC_META');
  var old=String(meta.getRange(1,1).getValue()||'A');
  var next=old==='A'?'B':'A';
  var sh=ss.getSheetByName('YC_STATE_'+next);
  var json=JSON.stringify(state);
  var parts=[];for(var i=0;i<json.length;i+=YC_CHUNK)parts.push([json.slice(i,i+YC_CHUNK)]);
  if(!parts.length)parts=[['{}']];
  var oldLen=Math.max(1,Number(meta.getRange(1,2).getValue()||1));
  sh.getRange(1,1,Math.max(oldLen,parts.length),1).clearContent();
  sh.getRange(1,1,parts.length,1).setValues(parts);
  SpreadsheetApp.flush();
  // 아래 포인터 변경이 사실상의 커밋 완료 지점입니다.
  meta.getRange(1,1,1,3).setValues([[next,parts.length,Date.now()]]);
  SpreadsheetApp.flush();
}
function ycText_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}
function ycJsonp_(callback,obj){
  if(!/^__yc_callback_[A-Za-z0-9_]{3,100}$/.test(callback))throw Error('허용되지 않은 callback 이름');
  return ContentService.createTextOutput(callback+'('+JSON.stringify(obj)+');').setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/** 읽기 쉬운 시트: 'YC_RESULTS' (개인전 200명 + 과거 단체전 50팀 호환 보관) */
function ycRebuildResults_(ss,state){
  var sh=ss.getSheetByName('YC_RESULTS');
  var rows=[['종목','번호','부문','기록(초)','상태','확정','시작시각','종료시각']];
  for(var i=1;i<=200;i++)rows.push(ycResultRow_(state,'individual','p_'+('00'+i).slice(-3)));
  for(var j=1;j<=50;j++)rows.push(ycResultRow_(state,'relay','t_'+('0'+j).slice(-2)));
  sh.getRange(1,1,rows.length,8).setValues(rows);
  sh.setFrozenRows(1);
}
function ycResultRow_(state,type,targetId){
  var runs=Object.keys(state.runs||{}).map(function(id){return state.runs[id];})
    .filter(function(r){return r && r.type===type && r.targetId===targetId;})
    .sort(function(a,b){return (a.startedAt||0)-(b.startedAt||0);});
  var r=runs.length?runs[runs.length-1]:null;
  var label=type==='individual'?'개인전':'단체전';
  var number=targetId.slice(2);
  var name=(!r?'대기':{running:'진행 중',finished:'완료',dnf:'미완주',dsq:'실격',cancelled:'취소'}[r.status]||r.status);
  var division=type==='individual'?(Number(number)<=150?'남자':'여자'):'—';
  return [label,number,division,(r&&r.elapsedMs!=null)?Number(r.elapsedMs)/1000:'',name,r&&r.verified?'확정':'',
    r&&r.startedAt?new Date(r.startedAt):'',r&&r.endedAt?new Date(r.endedAt):''];
}
function ycUpdateResults_(ss,state,command,req){
  if(command==='reset'){ycRebuildResults_(ss,state);return;}
  if(command!=='mutation')return;
  // 동시 출발하는 두 주자의 각 기록행을 모두 갱신합니다.
  var ids={};
  Object.keys(req.patches||{}).forEach(function(path){
    if(!/^runs\/run_[A-Za-z0-9_-]+$/.test(path))return;
    var r=req.patches[path];
    if(!r||!['individual','relay'].includes(r.type))return;
    var n=Number(String(r.targetId||'').slice(2));
    if(!(n>=1&&n<=(r.type==='individual'?200:50)))return;
    var row=r.type==='individual'?n+1:n+201;
    ids[row]=[r.type,r.targetId];
  });
  Object.keys(ids).forEach(function(row){
    var args=ids[row];
    ss.getSheetByName('YC_RESULTS').getRange(Number(row),1,1,8).setValues([ycResultRow_(state,args[0],args[1])]);
  });
}
