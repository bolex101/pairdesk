const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const num=v=>(typeof v==='number'||typeof v==='string'&&v.trim())?Number(v):NaN;
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-9,Math.abs(b)*1e-8);
function headers(key,route,time=Date.now()){
 if(!/^\/v1\/(account|perps\/(positions|fills))(\?|$)/.test(route))throw Error('Read endpoint only');
 return {'ONDO-KEY-ID':key.keyId,'ONDO-TIMESTAMP':String(time),'ONDO-SIGN':crypto.createHmac('sha256',key.secretKey).update(String(time)+'GET'+route).digest('hex')};
}
async function get(key,route){
 const response=await fetch('https://api.ondoperps.xyz'+route,{headers:headers(key,route),redirect:'error',signal:AbortSignal.timeout(8000),cache:'no-store'});
 if(!response.ok)throw Error('Ondo HTTP '+response.status+'; check view-only key, server clock and IP restriction');
 const data=await response.json();if(data.success!==true)throw Error('Ondo rejected read request');
 return data;
}
function identity(data,address){
 if(data?.success!==true||data.result?.authType!=='web3'||data.result.accountState!=='open'||typeof data.result.identifier!=='string'||data.result.identifier.toLowerCase()!==address.toLowerCase()||!data.result.accountID)throw Error('Ondo API key does not match the configured wallet');
}
function parse(data,address,now=Date.now()){
 if(data?.success!==true||!Array.isArray(data.result))throw Error('Invalid Ondo position snapshot');
 const rows=data.result.flatMap(p=>{
  const signed=num(p.netQuantity),price=num(p.averageEntryPrice);
  if(!Number.isFinite(signed)||!['long','short','neutral'].includes(p.direction))throw Error('Invalid Ondo position');
  if(!signed)return [];
  if(p.direction==='neutral'||typeof p.market!=='string'||!p.market.endsWith('-USD.P')||!(price>0)||!Number.isFinite(price*signed)||p.direction==='long'&&signed<0)throw Error('Invalid Ondo size or price');
  return [{symbol:p.market,side:p.direction.toUpperCase(),quantity:Math.abs(signed),price,enteredAt:null,generation:null}];
 });
 if(new Set(rows.map(r=>r.symbol)).size!==rows.length)throw Error('Duplicate Ondo position');
 return {account:'Ondo',venue:'Ondo',address,at:now,ok:true,rows};
}
function withHistory(account,fills,now=Date.now()){
 if(!Array.isArray(fills))throw Error('Invalid Ondo fill history');
 const seen=new Set();
 for(const f of fills){
  if(!f.id||seen.has(f.id)||typeof f.market!=='string')throw Error('Invalid or duplicate Ondo fill');
  seen.add(f.id);
 }
 for(const row of account.rows){
  row.generation=null;row.enteredAt=null;
  const rows=fills.filter(f=>f.market===row.symbol);
  let expected=(row.side==='LONG'?1:-1)*row.quantity,last=Infinity;
  for(const f of rows){
   const size=num(f.size),at=Date.parse(f.time),direction=String(f.direction||'').replace(/\s/g,'').toLowerCase();
   if(!(size>0)||!Number.isFinite(size)||!['buy','sell'].includes(f.side)||!Number.isFinite(at)||at<=0||at>now+5000||at>last)break;
   last=at;
   const delta=(f.side==='buy'?1:-1)*size,before=expected-delta;
   const opening=direction==='open'+row.side.toLowerCase(),closing=direction==='close'+row.side.toLowerCase();
   const flip=direction===(row.side==='LONG'?'flipshorttolong':'fliplongtoshort');
   if(!opening&&!closing&&!flip||opening&&Math.sign(delta)!==Math.sign(expected)||closing&&Math.sign(delta)===Math.sign(expected))break;
   if(near(before,0)&&opening||flip&&Math.sign(before)!==Math.sign(expected)&&!near(before,0)){
    row.enteredAt=at;row.generation=f.id;break;
   }
   if(Math.sign(before)!==Math.sign(expected)||flip)break;
   expected=before;
  }
 }
 return account;
}
function credentials(){
 const file=process.env.PAIRDESK_ONDO_KEY_FILE||(process.env.CREDENTIALS_DIRECTORY&&path.join(process.env.CREDENTIALS_DIRECTORY,'ondo-key'));
 if(!file)throw Error('Ondo view-only credentials are not configured');
 const key=JSON.parse(fs.readFileSync(file,'utf8'));
 if(typeof key.keyId!=='string'||!key.keyId||typeof key.secretKey!=='string'||!key.secretKey)throw Error('Incomplete Ondo view-only credentials');
 return key;
}
async function fetchAccount(address,key=credentials()){
 const started=Date.now();
 await get(key,'/v1/account').then(d=>identity(d,address));
 const account=parse(await get(key,'/v1/perps/positions'),address,started);
 if(account.rows.length){
  const fills=[],seen=new Set();let cursor;
  for(let page=0;page<3;page++){
   const q=new URLSearchParams({limit:'1000'});if(cursor)q.set('cursor',cursor);
   const data=await get(key,'/v1/perps/fills?'+q);
   if(!Array.isArray(data.result)||!data.pageInfo||typeof data.pageInfo!=='object')throw Error('Incomplete Ondo fills');
   fills.push(...data.result);withHistory(account,fills);
   if(account.rows.every(r=>r.generation)||!data.pageInfo.nextCursor)break;
   cursor=data.pageInfo.nextCursor;if(typeof cursor!=='string'||seen.has(cursor))throw Error('Invalid Ondo history cursor');seen.add(cursor);
  }
  const after=parse(await get(key,'/v1/perps/positions'),address);
  const exposure=x=>JSON.stringify(x.rows.map(r=>[r.symbol,r.side,r.quantity,r.price]).sort());
  if(exposure(account)!==exposure(after))throw Error('Ondo exposure changed while reading fills; retry next cycle');
 }
 return account;
}
module.exports={headers,identity,parse,withHistory,fetchAccount};
