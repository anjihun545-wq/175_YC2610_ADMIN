import {firebaseConfig, EVENT_ID} from './firebase-config.js';
const VERSION='12.19.0';
export const isConfigured=()=>['apiKey','authDomain','databaseURL','projectId','appId'].every(k=>Boolean(firebaseConfig[k]?.trim()));

export async function createCloud(callbacks) {
  const [{initializeApp},{getAuth,onAuthStateChanged,signInWithEmailAndPassword,signOut,setPersistence,browserLocalPersistence},{getDatabase,ref,onValue,update,runTransaction,goOnline}] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${VERSION}/firebase-database.js`)
  ]);
  const app=initializeApp(firebaseConfig);const auth=getAuth(app);const db=getDatabase(app);
  await setPersistence(auth,browserLocalPersistence);
  let subs=[];
  const remove=()=>{for(const fn of subs)fn();subs=[];};
  onAuthStateChanged(auth,user=>{
    remove();
    if(!user){callbacks.onIdentity(null,null);return;}
    let hasEventSubscription=false,unsubscribeEvent=null;
    function removeEvent(){if(unsubscribeEvent)unsubscribeEvent();unsubscribeEvent=null;hasEventSubscription=false;}
    function subscribeEvent(){
      hasEventSubscription=true;
      unsubscribeEvent=onValue(ref(db,`events/${EVENT_ID}`),snap=>callbacks.onData(snap.val()||null),e=>callbacks.onError(e));
      subs.push(unsubscribeEvent);
    }
    const uRole=onValue(ref(db,`roles/${user.uid}`),snap=>{
      const role=snap.val();callbacks.onIdentity(user,role);
      if(role!=='admin'&&role!=='viewer'){removeEvent();return;}
      if(!hasEventSubscription)subscribeEvent();
    },error=>callbacks.onError(error));
    subs.push(uRole);
    subs.push(onValue(ref(db,'.info/connected'),snap=>callbacks.onConnected(!!snap.val()),e=>callbacks.onError(e)));
    subs.push(onValue(ref(db,'.info/serverTimeOffset'),snap=>callbacks.onServerOffset(Number(snap.val())||0)));
  },error=>callbacks.onError(error));
  return {
    login:(email,password)=>signInWithEmailAndPassword(auth,email,password),
    logout:()=>signOut(auth),
    send:(patches)=>update(ref(db,`events/${EVENT_ID}`),patches),
    claim:async(deviceId)=>{
      const now=Date.now();
      const res=await runTransaction(ref(db,`events/${EVENT_ID}/clockLock`),current=>{
        if(!current||current.owner===deviceId||current.until<now)return {owner:deviceId,until:now+35000,updatedAt:now};
        return;
      },{applyLocally:false});
      return res.committed;
    },
    release:async(deviceId)=>{
      await runTransaction(ref(db,`events/${EVENT_ID}/clockLock`),current=>current?.owner===deviceId?null:undefined,{applyLocally:false});
    },
    wake:()=>goOnline(db)
  };
}
