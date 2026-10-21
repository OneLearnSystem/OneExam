const cfg=window.ONEEXAM_CONFIG||{};
export const configured=Boolean(cfg.supabaseUrl&&cfg.supabaseKey);
export const fresh=()=>({name:'',settings:{},attempts:[],bookmarks:[],drafts:{},answers:{},lastQuestion:null,session:null,plans:[],schoolTimes:{}});
let session=null;try{session=JSON.parse(localStorage.getItem('oneexam-auth')||'null')}catch{}
let revision=0,loaded=false,queue=Promise.resolve(),saveTimer;
export let state=fresh();
export function user(){return session?.user||null}
function emit(message){window.dispatchEvent(new CustomEvent('oneexam-sync',{detail:message}));}
function key(){return 'oneexam-data-'+(user()?.id||'guest')}
function restore(){try{state={...fresh(),...JSON.parse(localStorage.getItem(key())||'{}')}}catch{state=fresh()}}
restore();try{revision=JSON.parse(localStorage.getItem(key()+'-meta')||'{}').revision||0}catch{}
function authStore(s){session=s;localStorage.setItem('oneexam-auth',JSON.stringify(s));}
async function request(path,options={},auth=true){
 if(!configured)throw Error('Accounts are not connected yet. You can still practise as a guest.');
 if(auth&&session?.expires_at&&session.expires_at*1000<Date.now()+60000)await refresh();
 const r=await fetch(cfg.supabaseUrl+path,{...options,headers:{apikey:cfg.supabaseKey,'Content-Type':'application/json',...(auth&&session?.access_token?{Authorization:'Bearer '+session.access_token}:{}),...options.headers},signal:AbortSignal.timeout(20000)});
 const data=await r.json().catch(()=>null);if(!r.ok)throw Error(data?.msg||data?.error_description||data?.message||'The connection failed. Please try again.');return data;
}
function normalize(s){return {...s,expires_at:s.expires_at||Math.floor(Date.now()/1000)+(s.expires_in||3600)}}
let refreshing;
async function refresh(){if(!refreshing)refreshing=request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})},false).then(s=>authStore(normalize(s))).finally(()=>refreshing=null);return refreshing;}
export async function init(){
 const hash=new URLSearchParams(location.hash.slice(1));const access=hash.get('access_token');let recovery=false;
 if(access){session={access_token:access,refresh_token:hash.get('refresh_token'),expires_at:Math.floor(Date.now()/1000)+Number(hash.get('expires_in')||3600)};const u=await request('/auth/v1/user');session.user=u;authStore(session);recovery=hash.get('type')==='recovery';history.replaceState(null,'',location.pathname+location.search+'#dashboard');}
 if(user())await loadCloud();else loaded=true;return recovery;
}
export async function login(email,password){const s=await request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})},false);authStore(normalize(s));loaded=false;restore();await loadCloud();}
export async function signup(email,password,name){return request('/auth/v1/signup?redirect_to='+encodeURIComponent(location.origin+location.pathname),{method:'POST',body:JSON.stringify({email,password,data:{display_name:name}})},false).then(async s=>{if(s.access_token){authStore(normalize(s));restore();await loadCloud()}return s;});}
export async function reset(email){return request('/auth/v1/recover?redirect_to='+encodeURIComponent(location.origin+location.pathname),{method:'POST',body:JSON.stringify({email})},false);}
export async function changePassword(password){return request('/auth/v1/user',{method:'PUT',body:JSON.stringify({password})});}
export async function logout(){clearTimeout(saveTimer);await queue.catch(()=>{});try{await request('/auth/v1/logout?scope=local',{method:'POST'})}catch{}session=null;localStorage.removeItem('oneexam-auth');revision=0;loaded=true;restore();emit('Guest · saved on this device');}
export async function loadCloud(discardLocal=false){
 loaded=false;try{const rows=await request('/rest/v1/oneexam_progress?select=payload,revision&user_id=eq.'+encodeURIComponent(user().id));const row=rows[0],remoteRevision=row?.revision||0;let meta={};try{meta=JSON.parse(localStorage.getItem(key()+'-meta')||'{}')}catch{}
 if(meta.pending&&!discardLocal){if(meta.revision!==remoteRevision){emit('Progress changed on another device · export your local work before loading cloud progress');throw Error('Progress changed on another device. Your local work is preserved. Export it before loading the cloud copy.');}revision=remoteRevision;loaded=true;restore();await flush();return;}revision=remoteRevision;state={...fresh(),...(row?.payload||{})};if(!state.name)state.name=user()?.user_metadata?.display_name||'';loaded=true;localStorage.setItem(key(),JSON.stringify(state));localStorage.setItem(key()+'-meta',JSON.stringify({revision,pending:false}));emit('Saved to your free account');}
 catch(e){emit('Cloud unavailable · changes saved on this device');throw e;}
}
export function save(){localStorage.setItem(key(),JSON.stringify(state));if(user())localStorage.setItem(key()+'-meta',JSON.stringify({revision,pending:true}));if(!user()){emit('Guest · saved on this device');return;}emit('Saving…');clearTimeout(saveTimer);saveTimer=setTimeout(()=>flush().catch(()=>{}),650);}
export async function flush(){clearTimeout(saveTimer);if(!user())return;if(!loaded){emit('Cloud unavailable · local copy saved; retry from your account');return;}const uid=user().id,payload=JSON.parse(JSON.stringify(state));queue=queue.catch(()=>{}).then(async()=>{if(user()?.id!==uid)return;try{const r=await request('/rest/v1/rpc/oneexam_save',{method:'POST',body:JSON.stringify({p_payload:payload,p_revision:revision})});revision=r.revision;const unchanged=JSON.stringify(state)===JSON.stringify(payload);localStorage.setItem(key()+'-meta',JSON.stringify({revision,pending:!unchanged}));emit(unchanged?'Saved to your free account':'Saving…')}catch(e){if(e.message.includes('another device'))loaded=false;emit(e.message);throw e;}});return queue;}
export function localExport(){return JSON.stringify({exportedAt:new Date().toISOString(),data:state},null,2)}
