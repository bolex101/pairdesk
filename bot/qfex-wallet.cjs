'use strict';
const Log=require('./log.cjs');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),H=require('./linked-history.cjs');
function fingerprint(key){return crypto.createHash('sha256').update(key.publicKey).digest('hex');}
function validateKey(k){
 if(!k||typeof k.publicKey!=='string'||typeof k.secretKey!=='string'||!k.publicKey.startsWith('qfex_pub_')||!k.secretKey.startsWith('qfex_secret_')||[k.publicKey,k.secretKey].some(v=>!v||/[^\x21-\x7e]|["']/.test(v)))throw Error('QFEX raw key format invalid');
}
function auth(key,now=Date.now(),nonce=crypto.randomBytes(16).toString('hex')){
 validateKey(key);const unix_ts=Math.floor(now/1000);
 return {public_key:key.publicKey,nonce,unix_ts,signature:crypto.createHmac('sha256',key.secretKey).update(nonce+':'+unix_ts).digest('hex')};
}
async function get(key,route){
 if(!/^\/user\/(positions|trade)(\?|$)/.test(route))throw Error('QFEX read endpoint only');
 const a=auth(key);let r;
 try{r=await fetch('https://api.qfex.com'+route,{headers:{'x-qfex-public-key':a.public_key,'x-qfex-nonce':a.nonce,'x-qfex-timestamp':String(a.unix_ts),'x-qfex-hmac-signature':a.signature},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});}catch(e){throw Error('QFEX account connection unavailable',{cause:e});}
 if(!r.ok)throw Error('QFEX account HTTP '+r.status+'; verify primary-account key scope and view permissions');
 const date=Date.parse(r.headers.get('date'));if(!Number.isFinite(date)||Math.abs(Date.now()-date)>120000)throw Error('QFEX response time unverified');
 return r.json();
}
function parse(data,now=Date.now()){
 if(!data||!Object.hasOwn(data,'positions')||!data.balance||typeof data.balance!=='object'||Array.isArray(data.balance)||data.positions!==null&&!Array.isArray(data.positions))throw Error('QFEX positions schema invalid');
 const rows=[];
 for(const p of data.positions||[]){
 const signed=H.num(p.position),price=H.num(p.average_price);
 if(!Number.isFinite(signed))throw Error('QFEX invalid size');if(!signed)continue;
 if(!/^[A-Z0-9]+-USD$/.test(p.symbol)||!(price>0)||!Number.isFinite(price*signed))throw Error('QFEX invalid market or entry price');
 rows.push({symbol:p.symbol,side:signed>0?'LONG':'SHORT',quantity:Math.abs(signed),price,enteredAt:null,generation:null});
 }
 if(new Set(rows.map(r=>r.symbol)).size!==rows.length)throw Error('QFEX duplicate position');
 return {account:'QFEX',venue:'QFEX',at:now,ok:true,rows};
}
// REST gives the user's side; WS gives executed-trade timestamps. Never use
// aggressor_side as the user's side or order placement time as entry time.
function joinTrades(rest,wire){
 const by=new Map(wire.map(f=>[f.trade_id,f]));if(by.size!==wire.length)throw Error('QFEX duplicate execution');
 return rest.map(f=>{
 const w=by.get(f.id);
 if(!w||w.symbol!==f.symbol||!H.near(H.num(w.price),H.num(f.price))||!H.near(H.num(w.quantity),H.num(f.quantity)))throw Error('QFEX REST/WS fill correspondence unverified');
 if(w.side!==undefined&&w.side!==f.side)throw Error('QFEX REST/WS user-side mismatch');
 const seconds=H.num(w.timestamp);if(!(seconds>1e9&&seconds<1e11))throw Error('QFEX execution timestamp unverified');
 return {id:f.id,symbol:f.symbol,side:f.side,size:H.num(f.quantity),price:H.num(f.price),at:seconds*1000};
 });
}
function executions(key){
 validateKey(key);
 return new Promise((resolve,reject)=>{
 let ws,done=false,authed=false,offset=0,stage='connecting',messages=0;const rows=[],seen=new Set();
 const finish=err=>{if(done)return;done=true;clearTimeout(timer);try{ws?.close();}catch(e){Log.debug('QFEX socket close',e);}err?reject(err):resolve(rows);};
 const timer=setTimeout(()=>finish(Error('QFEX executed-history timeout; stage='+stage+'; page='+String(offset/1000+1)+'; messages='+messages)),20000);
 try{ws=new WebSocket('wss://trade.qfex.com?api_key='+encodeURIComponent(key.publicKey));}catch(e){finish(Error('QFEX executed-history connection unavailable',{cause:e}));return;}
 const request=()=>{stage='waiting for history';ws.send(JSON.stringify({type:'get_user_trades',params:{limit:1000,offset}}));};
 ws.onopen=()=>{try{stage='waiting for authentication';ws.send(JSON.stringify({type:'auth',params:{hmac:auth(key)}}));}catch(e){finish(Error('QFEX authentication request failed',{cause:e}));}};
 ws.onerror=()=>finish(Error('QFEX executed-history connection failed; stage='+stage));
 ws.onclose=()=>finish(Error('QFEX executed-history disconnected; stage='+stage));
 ws.onmessage=e=>{
 if(done)return;
 try{
 const m=JSON.parse(e.data);messages++;
 if(!m||typeof m!=='object'||Array.isArray(m))throw Error('QFEX invalid history message');
 // Never log raw error bodies: they may contain account or authentication data.
 if(m.err!=null||m.error!=null)throw Error('QFEX read request rejected; stage='+stage+'; verify View orders permission');
 if(Object.hasOwn(m,'authenticated')||m.type==='auth'){
 const success=Object.hasOwn(m,'authenticated')?m.authenticated===true:m.result==='success';
 if(!success)throw Error('QFEX authentication rejected; check primary-account key scope and view permissions');
 if(!authed){authed=true;request();}return;
 }
 const modern=Object.hasOwn(m,'user_trades_response'),legacy=Object.hasOwn(m,'user_trades');
 if(modern||legacy){
 if(!authed)throw Error('QFEX history arrived before verified authentication');
 const batch=modern?m.user_trades_response:m.user_trades;
 if(!Array.isArray(batch)||batch.length>1000)throw Error('QFEX executed-history response schema invalid');
 for(const row of batch){
 if(!row||typeof row.trade_id!=='string'||!row.trade_id||seen.has(row.trade_id))throw Error('QFEX history duplicate or invalid trade ID');
 seen.add(row.trade_id);
 }
 rows.push(...batch);
 if(batch.length<1000||rows.length>=3000)finish();else{offset+=1000;request();}
 }
 }catch(error){
 const safe=error instanceof Error&&error.message.startsWith('QFEX ')?error.message:'QFEX executed-history invalid JSON/schema';
 finish(Error(safe));
 }
 };
 });
}
function credentials(name='qfex-key'){
 if(!/^qfex-(key|friend-[1-9]\d{0,15})$/.test(name)||!process.env.CREDENTIALS_DIRECTORY)throw Error('QFEX credentials unavailable');
 const k=JSON.parse(fs.readFileSync(path.join(process.env.CREDENTIALS_DIRECTORY,name),'utf8'));validateKey(k);return k;
}
async function fetchAccount(config,key=credentials()){
 validateKey(key);if(config?.keyFingerprint&&config.keyFingerprint!==fingerprint(key))throw Error('QFEX credential does not match configured profile');
 const start=Date.now(),account=parse(await get(key,'/user/positions'),start);
 if(account.rows.length){
 const [rest,wire]=await Promise.all([(async()=>{const all=[];for(let offset=0;offset<3000;offset+=1000){const d=await get(key,'/user/trade?'+new URLSearchParams({limit:'1000',offset:String(offset)}));if(d.data===null&&d.count===0)d.data=[];if(!Array.isArray(d.data))throw Error('QFEX fills schema invalid');all.push(...d.data);if(d.data.length<1000)break;}return all;})(),executions(key)]);
 H.reconstruct(account,joinTrades(rest,wire));
 const after=parse(await get(key,'/user/positions'));if(H.exposure(account)!==H.exposure(after))throw Error('QFEX position changed during history read');
 }
 return account;
}
module.exports={auth,parse,joinTrades,executions,credentials,fingerprint,validateKey,fetchAccount};
