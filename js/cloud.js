import {firebaseConfig, EVENT_ID} from './firebase-config.js';
import {applyPatches,deepCopy,uid} from './core.js';
const VERSION='12.19.0';
export const isConfigured=()=>['apiKey','authDomain','databaseURL','projectId','appId'].every(k=>Boolean(firebaseConfig[k]?.trim()));
const generationOf=data=>Number(data?.meta?.generation||0);

export async function createCloud(callbacks) {
  const [{initializeApp},{getAuth,onAuthStateChanged,signInAnonymously,setPersistence,browserLocalPersistence},{getDatabase,ref,onValue,runTransaction,goOnline}]=await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${VERSION}/firebase-database.js`)
  ]);
  const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getDatabase(app);
  await setPersistence(auth,browserLocalPersistence);
  let subscribed=false, currentUser=null;
  onAuthStateChanged(auth,async user=>{
    if(!user){
      currentUser=null;
      try{await signInAnonymously(auth);}catch(e){callbacks.onError(e);}
      return;
    }
    currentUser=user;
    if(subscribed)return;
    subscribed=true;
    callbacks.onReady(user);
    onValue(ref(db,`events/${EVENT_ID}`),snapshot=>callbacks.onData(snapshot.val()||null),e=>callbacks.onError(e));
    onValue(ref(db,'.info/connected'),snap=>callbacks.onConnected(Boolean(snap.val())),e=>callbacks.onError(e));
    onValue(ref(db,'.info/serverTimeOffset'),snap=>callbacks.onServerOffset(Number(snap.val())||0));
  },e=>callbacks.onError(e));
  const eventRef=ref(db,`events/${EVENT_ID}`);
  return {
    // 이벤트 루트 트랜잭션으로 초기화 세대 비교. 오래된 오프라인 기록이 초기화 후 다시 살아나는 일을 차단.
    send:async(patches,expectedGeneration)=>{
      if(!currentUser)throw Error('Firebase 익명 연결을 기다리는 중입니다.');
      const tx=await runTransaction(eventRef,current=>{
        if(generationOf(current)!==expectedGeneration)return;
        return applyPatches(deepCopy(current||{}),patches);
      },{applyLocally:false});
      if(!tx.committed)throw Error('기록 초기화 버전이 달라 전송을 차단했습니다. 기존 미전송 기록을 백업하고 운영본부에 확인하세요.');
    },
    reset:async(scope,expectedGeneration)=>{
      if(!['individual','relay','all'].includes(scope))throw Error('잘못된 초기화 범위입니다.');
      if(!currentUser)throw Error('Firebase 연결이 필요합니다.');
      const id=`audit_${uid().replaceAll('-','')}`;
      const tx=await runTransaction(eventRef,current=>{
        if(generationOf(current)!==expectedGeneration||current?.status?.current)return;
        const next=deepCopy(current||{});
        if(scope==='all') { next.runs={}; next.audit={}; }
        else { next.runs=Object.fromEntries(Object.entries(next.runs||{}).filter(([,r])=>r.type!==scope)); }
        next.status={...(next.status||{}),current:null};
        next.clockLock=null;
        next.meta={...(next.meta||{}),generation:expectedGeneration+1,resetAt:Date.now(),resetScope:scope};
        next.audit={...(next.audit||{}),[id]:{id,action:'기록 초기화',detail:`범위: ${scope}`,at:Date.now(),actor:'ANONYMOUS'}};
        return next;
      },{applyLocally:false});
      if(!tx.committed)throw Error('다른 기기의 경기 진행 또는 기록 버전 변경으로 초기화가 취소됐습니다.');
      return tx.snapshot.val();
    },
    claim:async deviceId=>{
      if(!currentUser)throw Error('서버 연결 대기 중입니다.');
      const now=Date.now();
      const tx=await runTransaction(ref(db,`events/${EVENT_ID}/clockLock`),value=>{
        if(!value||value.owner===deviceId||value.until<now)return {owner:deviceId,until:now+35000,updatedAt:now};
      },{applyLocally:false});
      return tx.committed;
    },
    release:async deviceId=>{
      if(!currentUser)return;
      await runTransaction(ref(db,`events/${EVENT_ID}/clockLock`),value=>value?.owner===deviceId?null:undefined,{applyLocally:false});
    },
    wake:()=>goOnline(db)
  };
}
