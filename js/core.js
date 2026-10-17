export const emptyData=()=>({participants:{},teams:{},runs:{},audit:{},status:{}});
export const uid=()=> globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const msText=ms=>{
  if(!Number.isFinite(Number(ms)) || ms===null || ms===undefined) return '—';
  const hund=Math.floor(Math.max(0,Number(ms))/10);
  return `${String(Math.floor(hund/6000)).padStart(2,'0')}:${String(Math.floor(hund%6000/100)).padStart(2,'0')}.${String(hund%100).padStart(2,'0')}`;
};
export const elapsedLabel=ms=> `${(Number(ms)/1000).toFixed(2)}초`;
export const tsText=ts=>ts?new Date(ts).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
export const deepCopy=x=>JSON.parse(JSON.stringify(x));
export function applyPatches(object, patches) {
  for(const [path,value] of Object.entries(patches)) {
    const bits=path.split('/'); let parent=object;
    for(let i=0;i<bits.length-1;i++) parent=parent[bits[i]] ??= {};
    if(value===null) delete parent[bits.at(-1)]; else parent[bits.at(-1)]=deepCopy(value);
  }
  return object;
}
export const sortByBib=(a,b)=>String(a.bib||'').localeCompare(String(b.bib||''),'ko',{numeric:true});
export function latestRuns(data, type) {
  const result={};
  for(const run of Object.values(data.runs||{}).sort((a,b)=>(a.startedAt||0)-(b.startedAt||0))) {
    if(run.type===type) result[run.targetId]=run;
  }
  return result;
}
export function rankings(data,type,division='all') {
  const targets=type==='individual'?data.participants:data.teams;
  const last=latestRuns(data,type);
  return Object.values(targets||{}).filter(t=>division==='all'||t.division===division)
    .map(t=>({...t,run:last[t.id]||null}))
    .filter(t=>t.run?.status==='finished' && Number.isFinite(t.run.elapsedMs))
    .sort((a,b)=>a.run.elapsedMs-b.run.elapsedMs || sortByBib(a,b));
}
export function statusLabel(r) {
  if(!r) return '대기';
  return ({running:'진행 중',finished:r.verified?'확정':'잠정',dnf:'미완주',dsq:'실격',cancelled:'취소'})[r.status]||'대기';
}
export function csvRows(raw) {
  const result=[];let row=[];let cell='';let quoted=false;
  const text=raw.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') { if(quoted&&text[i+1]==='"'){cell+='"';i++;} else quoted=!quoted; }
    else if(c===','&&!quoted){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){ if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))result.push(row);row=[];cell=''; }
    else cell+=c;
  }
  if(quoted)throw Error('CSV 따옴표 형식이 올바르지 않습니다.');
  row.push(cell);if(row.some(v=>v.trim()))result.push(row);
  return result;
}
export function csvDownload(name, headers, rows) {
  const esc=s=>`"${String(s??'').replace(/"/g,'""')}"`;
  const str='\uFEFF'+[headers,...rows].map(r=>r.map(esc).join(',')).join('\r\n');
  const blob=new Blob([str],{type:'text/csv;charset=utf-8;'});
  const link=document.createElement('a'); link.href=URL.createObjectURL(blob);link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1500);
}

// 경기 명단을 입력받지 않습니다. 항상 동일한 고정 번호 200개 / 50팀을 클라이언트에서 생성합니다.
// Firebase에는 실제 경기기록만 저장하므로 사용자별 대량 명단 업로드가 필요 없습니다.
export const INDIVIDUAL_COUNT=200;
export const TEAM_COUNT=50;
export const padBib=(n,type)=>String(n).padStart(type==='individual'?3:2,'0');
export function presetData(data){
  const result={...emptyData(),...data};
  result.participants=Object.fromEntries(Array.from({length:INDIVIDUAL_COUNT},(_,i)=>{
    const bib=padBib(i+1,'individual'),id=`p_${bib}`;
    return [id,{id,bib,name:`${bib}번 참가자`,division:'전체',affiliation:''}];
  }));
  result.teams=Object.fromEntries(Array.from({length:TEAM_COUNT},(_,i)=>{
    const bib=padBib(i+1,'relay'),id=`t_${bib}`;
    return [id,{id,bib,teamName:`${bib}팀`,members:['1주자','2주자','3주자','4주자'],affiliation:''}];
  }));
  return result;
}
