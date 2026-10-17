import {APPS_SCRIPT_URL, EVENT_ID} from './apps-script-config.js';
import {uid} from './core.js';

const POLL_MS=5000; // Apps Script는 푸시 방식이 아닙니다. 대략 5초 폴링.
const REQUEST_TIMEOUT_MS=45000;
export const isConfigured=()=>/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec(?:\?.*)?$/.test(APPS_SCRIPT_URL.trim());

/**
 * GitHub Pages <-> Apps Script 통신
 * - 읽기: JSONP (Apps Script ContentService의 외부 출처 CORS 제약을 우회)
 * - 쓰기: 숨겨진 iframe으로 POST form, 서버 수신 여부는 다음 JSONP 상태 조회로 검증
 * - 요청 ID를 고정해서 재시도에도 서버에서 중복 처리되지 않게 합니다.
 */
export async function createCloud(callbacks) {
  if(!isConfigured())throw Error('Apps Script 웹 앱 주소(/exec)가 잘못되었습니다.');
  let disposed=false, polling=false, lastOK=0, connected=false;
  let latest=null, seq=0;
  const waiters=new Map();

  function setConnected(v){
    if(connected!==v){connected=v;callbacks.onConnected(v);}
  }
  function getJSONP(extra={}){
    return new Promise((resolve,reject)=>{
      const cb=`__yc_callback_${Date.now()}_${++seq}`;
      const uri=new URL(APPS_SCRIPT_URL);
      uri.searchParams.set('action','state');
      uri.searchParams.set('event',EVENT_ID);
      uri.searchParams.set('callback',cb);
      uri.searchParams.set('_',String(Date.now()));
      const script=document.createElement('script');
      let ended=false;
      const cleanup=()=>{
        if(ended)return;ended=true;
        clearTimeout(timer);script.remove();try{delete window[cb];}catch{}
      };
      window[cb]=data=>{cleanup();resolve(data);};
      script.onerror=()=>{cleanup();reject(new Error('Apps Script 읽기 실패: URL·배포 권한·인터넷을 확인하세요.'));};
      const timer=setTimeout(()=>{cleanup();reject(new Error('Apps Script 응답 시간 초과'));},13000);
      script.src=uri.toString();
      document.head.appendChild(script);
    });
  }
  async function poll(){
    if(disposed||polling)return;
    polling=true;
    try{
      const response=await getJSONP();
      if(!response?.ok)throw Error(response?.error||'Apps Script 조회 오류');
      lastOK=Date.now();setConnected(true);
      latest=response.data||{};
      callbacks.onServerOffset(Number(response.serverTime||Date.now())-Date.now());
      callbacks.onData(latest);
      const ack=latest.acks||{};
      for(const [id,w] of waiters){
        const status=ack[id];
        if(!status)continue;
        waiters.delete(id);clearTimeout(w.timer);
        if(status.ok)w.resolve({...(status.result||{}),data:latest});
        else w.reject(new Error(status.error||'서버가 요청을 거절했습니다.'));
      }
    }catch(e){
      if(Date.now()-lastOK>POLL_MS*2)setConnected(false);
      callbacks.onError(e);
    }finally{polling=false;}
  }
  function postForm(payload){
    // Apps Script Web App은 외부 도메인 fetch에 CORS 응답을 주지 않는 경우가 있어
    // HTML form POST를 사용하고 JSONP 폴링으로 영속 저장 ACK를 별도 확인합니다.
    const iframe=document.createElement('iframe');
    const frameName='yc_post_'+uid().replace(/[^A-Za-z0-9]/g,'');
    iframe.name=frameName;
    iframe.title='Apps Script 데이터 전송';
    iframe.setAttribute('aria-hidden','true');
    iframe.style.cssText='display:none;width:0;height:0;border:0';
    const form=document.createElement('form');
    form.method='POST';form.action=APPS_SCRIPT_URL;form.target=frameName;form.style.display='none';
    const input=document.createElement('input');input.type='hidden';input.name='payload';input.value=JSON.stringify(payload);
    form.appendChild(input);document.body.appendChild(iframe);document.body.appendChild(form);
    try{form.submit();}finally{form.remove();setTimeout(()=>iframe.remove(),15000);}
  }
  async function command(commandType, fields, requestId=uid()){
    if(!connected)throw Error('Apps Script 연결을 확인한 뒤 다시 시도하세요.');
    if(waiters.has(requestId))return waiters.get(requestId).promise;
    let resolve,reject;
    const promise=new Promise((rs,rj)=>{resolve=rs;reject=rj;});
    const waiter={resolve,reject,promise,timer:null};
    waiters.set(requestId,waiter);
    waiter.timer=setTimeout(()=>{
      if(waiters.get(requestId)===waiter){waiters.delete(requestId);reject(new Error('서버 저장 확인이 늦어지고 있습니다. 기기의 미전송 기록을 유지합니다.'));}
    },REQUEST_TIMEOUT_MS);
    try{postForm({id:requestId,command:commandType,event:EVENT_ID,...fields});}
    catch(e){clearTimeout(waiter.timer);waiters.delete(requestId);reject(e);}
    // 요청 전송 직후 첫 확인. 서버가 아직 처리 중이면 다음 폴링에서 ACK됩니다.
    setTimeout(()=>void poll(),1600);
    return promise;
  }
  const interval=setInterval(()=>void poll(),POLL_MS);
  setTimeout(()=>{callbacks.onReady(null);void poll();},0);
  return {
    send:(patches,generation,requestId=uid(),deviceId='')=>command('mutation',{patches,generation,deviceId},requestId),
    claim:async deviceId=>(await command('claim',{deviceId})).claimed===true,
    release:async deviceId=>{await command('release',{deviceId});},
    reset:async(scope,generation)=>{const result=await command('reset',{scope,generation});return result.data;},
    wake:()=>void poll(),
    stop:()=>{disposed=true;clearInterval(interval);for(const waiter of waiters.values()){clearTimeout(waiter.timer);waiter.reject(new Error('연결 종료'));}waiters.clear();}
  };
}
