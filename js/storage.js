const NAME = 'ycps-2026-local-v1';
let connection;

function openDatabase() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', {keyPath: 'id'});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return connection;
}
function requestPromise(request) {
  return new Promise((resolve,reject)=>{ request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error); });
}
function done(tx) {
  return new Promise((resolve,reject)=>{ tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error || new Error('DB 트랜잭션 취소')); });
}
export async function loadLocal() {
  const db=await openDatabase(); const tx=db.transaction(['kv','outbox'],'readonly');
  const snapshot=requestPromise(tx.objectStore('kv').get('snapshot'));
  const outbox=requestPromise(tx.objectStore('outbox').getAll());
  const [data, queue]=await Promise.all([snapshot,outbox]); await done(tx);
  return {data:data || null, queue:queue || []};
}
export async function saveSnapshot(snapshot) {
  const db=await openDatabase(); const tx=db.transaction('kv','readwrite');
  tx.objectStore('kv').put(snapshot,'snapshot'); await done(tx);
}
export async function persistChange(snapshot, item) {
  const db=await openDatabase(); const tx=db.transaction(['kv','outbox'],'readwrite');
  tx.objectStore('kv').put(snapshot,'snapshot');
  if(item) tx.objectStore('outbox').put(item);
  await done(tx);
}
export async function removeOutbox(id) {
  const db=await openDatabase(); const tx=db.transaction('outbox','readwrite');
  tx.objectStore('outbox').delete(id); await done(tx);
}
export async function clearAll() {
  const db=await openDatabase(); const tx=db.transaction(['kv','outbox'],'readwrite');
  tx.objectStore('kv').clear(); tx.objectStore('outbox').clear(); await done(tx);
}
