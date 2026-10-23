// 200 fixed bibs: 001-150 men, 151-200 women. 2 entrants per heat.
export const DIVISIONS={male:{label:'남자 개인전',first:1,last:150,prefix:'M'},female:{label:'여자 개인전',first:151,last:200,prefix:'F'}};
export const pad=n=>String(n).padStart(3,'0');
export const targetId=n=>`p_${pad(n)}`;
export const heatId=(division,index)=>`${DIVISIONS[division].prefix}${String(index+1).padStart(3,'0')}`;
export function heatsFor(division){
  const d=DIVISIONS[division];if(!d)throw Error('Invalid division');
  return Array.from({length:(d.last-d.first+1)/2},(_,index)=>({id:heatId(division,index),division,index,bibs:[d.first+index*2,d.first+index*2+1],ids:[targetId(d.first+index*2),targetId(d.first+index*2+1)]}));
}
export function lastRuns(data){
  const last={};for(const r of Object.values(data.runs||{}).sort((a,b)=>(a.startedAt||0)-(b.startedAt||0)))if(r.type==='individual')last[r.targetId]=r;
  return last;
}
export const eligible=r=>!r||r.status==='cancelled';
export function heatState(data,heat){
  const lr=lastRuns(data),items=heat.ids.map(id=>lr[id]||null);
  const active=items.filter(r=>r?.status==='running');
  return {items,active,completed:items.every(r=>r && r.status!=='running' && r.status!=='cancelled'),available:items.every(eligible),partial:items.some(r=>r && r.status!=='cancelled')};
}
export function progress(data,division){
  const last=lastRuns(data),all=heatsFor(division).flatMap(h=>h.ids),completed=all.filter(id=>last[id]&&!['running','cancelled'].includes(last[id].status)).length;
  return {completed,total:all.length,waiting:all.length-completed};
}
export function startingPatches({data,heat,deviceId,startedAt,idFactory}){
  if(data.status?.current)throw Error('다른 조의 경기가 진행 중입니다.');
  if(!heatState(data,heat).available)throw Error('이미 계측한 선수가 포함되어 있습니다. 기록 수정 또는 취소 후 재시작하세요.');
  const ids=[],patches={};
  for(const target of heat.ids){
    const id='run_'+idFactory();ids.push(id);
    patches[`runs/${id}`]={id,type:'individual',targetId:target,heatId:heat.id,division:heat.division,startedAt,endedAt:null,elapsedMs:null,status:'running',verified:false,accuracy:'monotonic',deviceId,updatedAt:startedAt};
  }
  patches['status/current']={runIds:ids,heatId:heat.id,type:'individual',startedAt,heartbeatAt:startedAt};
  return {patches,ids};
}
export function finishingPatches(data,runId,{endedAt,elapsedMs,status='finished',accuracy='monotonic'}){
  const current=data.status?.current;
  if(!current?.runIds?.includes(runId))throw Error('현재 계측 중인 선수가 아닙니다.');
  const r=data.runs?.[runId];if(!r||r.status!=='running')throw Error('이미 종료된 선수입니다.');
  if(!['finished','dnf','dsq'].includes(status))throw Error('잘못된 경기 종료 상태');
  const updated={...r,status,endedAt,elapsedMs:status==='finished'?Math.round(Math.max(0,elapsedMs)/10)*10:null,verified:false,accuracy,updatedAt:endedAt};
  const remaining=current.runIds.filter(id=>id!==runId);
  return {[`runs/${runId}`]:updated,'status/current':remaining.length?{...current,runIds:remaining,heartbeatAt:endedAt}:null};
}
