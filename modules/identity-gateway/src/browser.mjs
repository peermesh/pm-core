import {randomBytes,createHash} from 'node:crypto';

const SESSION='__Host-pm_session', FLOW='__Host-pm_login';
const opaque=/^[A-Za-z0-9_-]{43}$/;
const hash=value=>createHash('sha256').update(value).digest('hex');
const random=()=>randomBytes(32).toString('base64url');
const fail=(status=401)=>{throw Object.assign(new Error(status===403?'Forbidden':'Unauthorized'),{status});};
const escape=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cookie=(name,value,age)=>`${name}=${value}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Lax`;
const response=(status,body='',extra={})=>({status,body,headers:{
  'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Type':'text/html; charset=utf-8',
  'Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options':'nosniff',...extra}});
function readCookie(headers,name){
  if(headers.cookie===undefined)return undefined;
  if(typeof headers.cookie!=='string'||headers.cookie.length>16384)fail();
  const found=headers.cookie.split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));
  if(found.length>1)fail();
  if(!found.length)return undefined;
  const value=found[0].slice(name.length+1);
  if(!opaque.test(value))fail();
  return value;
}
function returnPath(value='/'){
  if(typeof value!=='string'||value.length>1024||!value.startsWith('/')||value.startsWith('//')||/[\\\x00-\x20]/.test(value))fail();
  const u=new URL(value,'https://local.invalid');
  if(u.origin!=='https://local.invalid'||u.pathname.startsWith('/_core/')||u.hash)fail();
  return u.pathname+u.search;
}
function csrf(headers,origin){
  if(headers.origin!==origin || (headers['sec-fetch-site']!==undefined && headers['sec-fetch-site']!=='same-origin'))fail(403);
}
async function exchange(fetcher,providerOrigin,form){
  const r=await fetcher(providerOrigin+'/api/sso/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
    headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams(form).toString()});
  if(!r.ok||!r.body)fail();
  let size=0;const chunks=[];
  for await(const chunk of r.body){size+=chunk.length;if(size>65536)fail();chunks.push(chunk);}
  const tokens=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(tokens.token_type?.toLowerCase()!=='bearer'||typeof tokens.access_token!=='string'||tokens.access_token.length>16384||
    typeof tokens.refresh_token!=='string'||tokens.refresh_token.length>16384||!tokens.refresh_token)fail();
  return tokens;
}

// One Core process owns a bounded volatile store. Restart loses sessions and
// requires login; no token database, browser token storage or module auth code.
export function createBrowserAuth(config,{verify,fetcher=fetch,clock=Date.now}={}){
  if(typeof verify!=='function'||!Array.isArray(config.origins)||!config.origins.length||config.origins.length>8)throw Error('invalid browser configuration');
  const origins=new Set(config.origins);
  for(const origin of origins){const u=new URL(origin);if(u.origin!==origin||u.protocol!=='https:'||u.username||u.password||u.hostname==='peers.social')throw Error('invalid browser origin');}
  if(typeof config.clientId!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(config.clientId))throw Error('invalid client ID');
  const provider=new URL(config.providerOrigin);
  if(provider.origin!==config.providerOrigin||!(provider.origin==='https://peers.social'||(config.fixture===true&&provider.protocol==='http:'&&provider.hostname==='idp-check-social')))throw Error('invalid provider origin');
  const flows=new Map(),sessions=new Map();
  const idleMs=30*60*1000,absoluteMs=8*60*60*1000;
  function originFor(headers,forwarded=false){
    const host=headers[forwarded?'x-forwarded-host':'host'];
    if(typeof host!=='string'||headers['x-forwarded-proto']!=='https'||!origins.has('https://'+host))fail();
    return 'https://'+host;
  }
  function sweep(){
    const now=clock();
    for(const [key,f] of flows)if(f.until<=now)flows.delete(key);
    for(const [key,s] of sessions)if(s.until<=now||s.last+idleMs<=now)sessions.delete(key);
  }
  async function checked(tokens,subject){
    const headers=await verify('Bearer '+tokens.access_token);
    if(subject&&headers['X-Peermesh-Auth-Subject']!==subject)fail();
    // Read expiry only after the existing signature/issuer/audience verifier.
    const claims=JSON.parse(Buffer.from(tokens.access_token.split('.')[1],'base64url'));
    if(!Number.isSafeInteger(claims.exp)||claims.exp*1000<=clock())fail();
    return {access:tokens.access_token,refresh:tokens.refresh_token,expires:claims.exp*1000,subject:headers['X-Peermesh-Auth-Subject'],headers};
  }
  async function sessionHeaders(headers,origin){
    const value=readCookie(headers,SESSION);if(!value)fail();
    const key=hash(value),s=sessions.get(key),now=clock();
    if(!s||s.origin!==origin)fail();
    if(s.until<=now||s.last+idleMs<=now){sessions.delete(key);fail();}
    try{
      let identity;
      if(s.expires<=now+30000){
        if(!s.refreshing)s.refreshing=(async()=>{
          const tokens=await exchange(fetcher,provider.origin,{grant_type:'refresh_token',client_id:config.clientId,refresh_token:s.refresh});
          const {headers,...next}=await checked(tokens,s.subject);
          if(sessions.get(key)!==s)fail();
          Object.assign(s,next);return headers;
        })().finally(()=>{s.refreshing=undefined;});
        identity=await s.refreshing;
      }else identity=await verify('Bearer '+s.access);
      if(sessions.get(key)!==s||s.until<=clock()||identity['X-Peermesh-Auth-Subject']!==s.subject)fail();
      s.last=clock();return identity;
    }catch{sessions.delete(key);fail();}
  }
  return {
    async authorize(headers){
      const origin=originFor(headers,true),method=headers['x-forwarded-method'];
      if(typeof method!=='string'||!/^[A-Z]{3,12}$/.test(method))fail();
      const supplied=readCookie(headers,SESSION);
      if(headers.authorization!==undefined){
        if(supplied)fail();
        if(headers.origin!==undefined)csrf(headers,origin);
        return verify(headers.authorization);
      }
      if(!['GET','HEAD','OPTIONS'].includes(method))csrf(headers,origin);
      return sessionHeaders(headers,origin);
    },
    async handle(req){
      const origin=originFor(req.headers),url=new URL(req.url,origin);
      if(url.origin!==origin||req.url.length>4096)fail();
      const path=url.pathname;
      if(path==='/_core/auth/login'&&req.method==='GET'){
        const target=returnPath(url.searchParams.get('return')||'/');
        return response(200,'<!doctype html><html><meta charset="utf-8"><title>Sign in</title><main><h1>Sign in</h1><form method="get" action="/_core/auth/start"><input type="hidden" name="return" value="'+escape(target)+'"><button>Sign in with peers.social</button></form></main></html>',{
          'Content-Security-Policy':"default-src 'none'; form-action 'self' https://peers.social; frame-ancestors 'none'; base-uri 'none'"});
      }
      if(path==='/_core/auth/start'&&req.method==='GET'){
        const target=returnPath(url.searchParams.get('return')||'/');
        sweep();if(flows.size>=1000)fail(503);
        const old=readCookie(req.headers,FLOW);
        if(old)for(const [key,f] of flows)if(f.binding===hash(old)&&f.origin===origin)flows.delete(key);
        const state=random(),binding=random(),verifier=random();
        flows.set(state,{binding:hash(binding),verifier,origin,target,until:clock()+300000});
        const authorize=new URL('https://peers.social/api/sso/authorize');
        authorize.search=new URLSearchParams({response_type:'code',client_id:config.clientId,redirect_uri:origin+'/_core/auth/callback',scope:'openid profile handle',
          state,code_challenge: createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
        return response(303,'',{Location:authorize.href,'Set-Cookie':[cookie(FLOW,binding,300)]});
      }
      if(path==='/_core/auth/callback'&&req.method==='GET'){
        const state=url.searchParams.get('state'),code=url.searchParams.get('code'),binding=readCookie(req.headers,FLOW);
        if(url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length!==1||!opaque.test(state||'')||
          !/^[A-Za-z0-9_-]{32,128}$/.test(code||'')||url.searchParams.has('error'))fail();
        const f=flows.get(state);
        if(!f||f.consuming||!binding||f.binding!==hash(binding)||f.origin!==origin||f.until<=clock())fail();
        f.consuming=true;
        let next;
        try {
          const tokens=await exchange(fetcher,provider.origin,{grant_type:'authorization_code',client_id:config.clientId,code,
            redirect_uri:origin+'/_core/auth/callback',code_verifier:f.verifier});
          const checkedResult=await checked(tokens);
          if(flows.get(state)!==f||f.until<=clock())fail();
          const {headers,...credentials}=checkedResult;next=credentials;
        } finally { flows.delete(state); }
        sweep();if(sessions.size>=10000)fail(503);
        const old=readCookie(req.headers,SESSION);
        if(old&&sessions.get(hash(old))?.origin===origin)sessions.delete(hash(old));
        const value=random();sessions.set(hash(value),{...next,origin,last:clock(),until:clock()+absoluteMs});
        return response(303,'',{Location:f.target,'Set-Cookie':[cookie(SESSION,value,absoluteMs/1000),cookie(FLOW,'',0)]});
      }
      if(path==='/_core/auth/session'&&req.method==='GET'){
        await sessionHeaders(req.headers,origin);
        // no-referrer makes Chromium send Origin: null on a navigation POST.
        // This page has no code/token URL; same-origin permits the CSRF check
        // while still withholding its referrer from any other origin.
        return response(200,'<!doctype html><html><meta charset="utf-8"><title>Signed in</title><main><h1>Signed in</h1><form method="post" action="/_core/auth/logout"><button>Sign out of this site</button></form></main></html>',{'Referrer-Policy':'same-origin'});
      }
      if(path==='/_core/auth/logout'&&req.method==='POST'){
        csrf(req.headers,origin);
        const value=readCookie(req.headers,SESSION),flow=readCookie(req.headers,FLOW);
        if(value&&sessions.get(hash(value))?.origin===origin)sessions.delete(hash(value));
        if(flow)for(const [key,f] of flows)if(f.binding===hash(flow)&&f.origin===origin)flows.delete(key);
        return response(303,'',{Location:'/_core/auth/login','Set-Cookie':[cookie(SESSION,'',0),cookie(FLOW,'',0)]});
      }
      fail();
    },
    loginRequired(headers){
      // No provider code, token, raw URL, cookie or exception is reflected.
      const target=(()=>{try{return returnPath(headers['x-forwarded-uri']||'/');}catch{return '/';}})();
      return response(401,'<!doctype html><html><meta charset="utf-8"><title>Sign in required</title><main><h1>Sign in required</h1><a href="/_core/auth/login?return='+encodeURIComponent(target)+'">Sign in</a></main></html>');
    },
  };
}
