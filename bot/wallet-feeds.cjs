const Log=require('./log.cjs');
const D=require('./data.cjs'),Risk=require('./risk.cjs');
const num=v=>typeof v==='number'||typeof v==='string'&&v.trim()!==''?Number(v):NaN;
const addressOK=(a,w)=>typeof a==='string'&&a.toLowerCase()===w.toLowerCase();
function arcus(data,w,index,now){
 if(!data||!data.positions||Array.isArray(data.positions)||typeof data.positions!=='object'||data.total===null||Number(data.total)!==Object.keys(data.positions).length)throw Error('Invalid or incomplete Arcus snapshot');
 const rows=[];
 for(const r of Object.values(data.positions)){
  if(!addressOK(r.address,w)||r.accountIndex!==index||!['LONG','SHORT'].includes(r.side)||typeof r.marketDisplayName!=='string')throw Error('Invalid Arcus position identity');
  const signed=num(r.size),price=num(r.averageEntryPrice);
  if(!Number.isFinite(signed))throw Error('Invalid Arcus size');
  if(!signed)continue;
  if(!(price>0)||!Number.isFinite(price)||!Number.isFinite(price*signed)||(r.side==='LONG'&&signed<0)||(r.side==='SHORT'&&signed>0))throw Error('Invalid Arcus position');
  rows.push(Risk.withLiquidation({symbol:r.marketDisplayName,side:r.side,quantity:Math.abs(signed),price,enteredAt:null,generation:null},r));
 }
 return {account:'Arcus:'+index,venue:'Arcus',address:w,index,at:now,ok:true,rows};
}
function withFills(snapshot,data,now){
 if(!data||!Array.isArray(data.fills)||Number(data.total)!==data.fills.length)return snapshot;
 if(data.fills.some(r=>!r.tradeId||!addressOK(r.address,snapshot.address)||r.accountIndex!==snapshot.index))return snapshot;
 const unique=[...new Map(data.fills.map(r=>[r.tradeId,r])).values()];
 for(const row of snapshot.rows){
  const rows=unique.filter(r=>r.marketDisplayName===row.symbol).sort((a,b)=>num(a.createdAt)-num(b.createdAt));
  const opens=rows.filter(r=>r.positionEffect==='OPEN_'+row.side);
  const last=opens.at(-1);if(!last||!last.orderId)continue;
  const opening=opens.filter(r=>r.orderId===last.orderId)[0],start=num(opening.createdAt);
  const fills=rows.filter(r=>num(r.createdAt)>=start);
  if(!(start>0)||!Number.isFinite(start)||start/1000>now+5000||fills.some(r=>!['BUY','SELL'].includes(r.side)||!(num(r.size)>0)||!Number.isFinite(num(r.size))||String(r.positionEffect).startsWith('FLIP')))continue;
  // Reject truncated histories or reopen/flip ambiguity instead of inventing an entry time.
  let signed=0,continuous=true;
  for(const r of fills){signed+=(r.side==='BUY'?1:-1)*num(r.size);if(!Number.isFinite(num(r.createdAt))||signed*(row.side==='LONG'?1:-1)<=0)continuous=false;}
  if(!continuous)continue;
  if(Math.abs(signed-(row.side==='LONG'?1:-1)*row.quantity)>Math.max(1e-8,row.quantity*1e-6))continue;
  row.enteredAt=start/1000;row.generation=String(last.orderId);
 }
 return snapshot;
}
function popdex(data,w,now){
 if(!data||String(data.code)!=='200'||!Array.isArray(data.data)||!Number.isFinite(num(data.blockTime))||now-num(data.blockTime)>120000||num(data.blockTime)>now+5000||!/^\d+$/.test(String(data.blockNumber)))throw Error('Invalid/stale Popdex snapshot');
 const rows=[];
 for(const r of data.data){
  if(r.category!=='Futures')throw Error('Unexpected Popdex position category');
  const quantity=num(r.holdQty),price=num(r.avgOpenPrice),enteredAt=num(r.createdAt);
  if(!Number.isFinite(quantity)||quantity<0)throw Error('Invalid Popdex size');
  if(!quantity)continue;
  if(!['Long','Short'].includes(r.positionSide)||typeof r.symbol!=='string'||!r.id||!(price>0)||!Number.isFinite(price)||!Number.isFinite(price*quantity)||!(enteredAt>0)||enteredAt>now+5000)throw Error('Invalid Popdex position');
  rows.push(Risk.withLiquidation({symbol:r.symbol,side:r.positionSide.toUpperCase(),quantity,price,enteredAt,generation:String(r.id)},r));
 }
 return {account:'Popdex',venue:'Popdex',at:now,ok:true,revision:String(data.blockNumber),rows};
}
async function fetchAccounts(config){
 if(!config?.enabled)return [];
 const w=config.address;
 if(!/^0x[a-fA-F0-9]{40}$/.test(w))throw Error('Invalid public wallet address');
 const tasks=[];
 if(config.popdex!==false)tasks.push(async()=>{
  try{return popdex(await D.get('https://api.popdex.xyz/api/v1/account/'+w+'/positions'),w,Date.now());}
  catch(e){Log.warn('Popdex wallet check unavailable',e);return {account:'Popdex',venue:'Popdex',ok:false,at:Date.now(),rows:[]};}
 });
 for(const index of config.arcusAccountIndices){
  if(!Number.isInteger(index)||index<0||index>9)throw Error('Invalid subaccount');
  tasks.push(async()=>{
   try{
    const snapshot=arcus(await D.get('https://api.arcus.xyz/v1/positions?'+new URLSearchParams({address:w,accountIndex:String(index)})),w,index,Date.now());
    if(snapshot.rows.length)try{withFills(snapshot,await D.get('https://api.arcus.xyz/v1/fills?'+new URLSearchParams({address:w,accountIndex:String(index),limit:'1000'})),Date.now());}catch(e){Log.warn('Arcus fills unavailable; entry times left unknown',e);}
    return snapshot;
   }catch(e){Log.warn('Arcus wallet check unavailable',e);return {account:'Arcus:'+index,venue:'Arcus',ok:false,at:Date.now(),rows:[]};}
  });
 }
 if(config.phoenix?.enabled)tasks.push(async()=>({phoenixAccounts:await require('./phoenix-wallet.cjs').fetchAccounts(config.phoenix)}));
 if(config.ondo?.enabled)tasks.push(async()=>{
  try{return await require('./ondo-wallet.cjs').fetchAccount(w);}
  catch(e){Log.warn('Ondo wallet check unavailable',e);return {account:'Ondo',venue:'Ondo',ok:false,at:Date.now(),rows:[]};}
 });
 if(config.risex?.enabled)tasks.push(async()=>{try{return await require('./risex-wallet.cjs').fetchAccount(config.risex.address);}catch(e){Log.warn('RISEx wallet check unavailable',e);return {account:'RISEx',venue:'RISEx',ok:false,at:Date.now(),rows:[]};}});
 if(config.qfex?.enabled)tasks.push(async()=>{try{return await require('./qfex-wallet.cjs').fetchAccount(config.qfex);}catch(e){Log.warn('QFEX wallet check unavailable',e);return {account:'QFEX',venue:'QFEX',ok:false,at:Date.now(),rows:[]};}});
 const out=[];let next=0;
 await Promise.all(Array.from({length:3},async()=>{while(next<tasks.length)out.push(await tasks[next++]());}));
 return out.flatMap(x=>x.phoenixAccounts||[x]);
}
module.exports={arcus,withFills,popdex,fetchAccounts};

