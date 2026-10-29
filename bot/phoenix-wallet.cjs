const Log=require('./log.cjs');
const D=require('./data.cjs'),Risk=require('./risk.cjs'),Sol=require('./solana.cjs');
const BASE='https://perp-api.phoenix.trade';
const num=v=>(typeof v==='number'||typeof v==='string'&&v.trim())?Number(v):NaN;
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-9,Math.abs(b)*1e-8);
function parse(data,markets,address,index,subaccounts,at,now=Date.now()){
 if(data?.authority!==address||data.traderPdaIndex!==index||!Number.isSafeInteger(data.slot)||data.slot<=0||data.snapshot?.version!==1||!Array.isArray(data.snapshot.subaccounts)||!Array.isArray(markets?.markets)||!Number.isFinite(at)||now-at>120000||at>now+5000)throw Error('Invalid or stale Phoenix account snapshot');
 if(new Set(data.snapshot.subaccounts.map(s=>s.subaccountIndex)).size!==data.snapshot.subaccounts.length)throw Error('Duplicate Phoenix subaccount');
 return subaccounts.map(sub=>{
  const s=data.snapshot.subaccounts.find(s=>s.subaccountIndex===sub);
  if(!s||s.positions!==undefined&&!Array.isArray(s.positions))throw Error('Missing Phoenix subaccount');
  const rows=(s.positions||[]).flatMap(p=>{
   const m=markets.markets.find(m=>m.symbol===p.symbol),lots=num(p.basePositionLots);
   if(!/^-?\d+$/.test(String(p.basePositionLots))||!Number.isSafeInteger(lots))throw Error('Invalid Phoenix base lots');
   if(!lots)return [];
   if(!m||!Number.isInteger(m.baseLotsDecimals)||m.baseLotsDecimals<0||m.baseLotsDecimals>12)throw Error('Missing Phoenix lot conversion');
   const quantity=Math.abs(lots)/10**m.baseLotsDecimals,price=num(p.entryPriceUsd);
   if(!(price>0)||!Number.isFinite(price*quantity)||p.basePositionUnits!==undefined&&!near(num(p.basePositionUnits),lots/10**m.baseLotsDecimals))throw Error('Invalid Phoenix price or units');
   return [Risk.withLiquidation({symbol:p.symbol,side:lots>0?'LONG':'SHORT',quantity,price,enteredAt:null,generation:null},p)];
  });
  if(new Set(rows.map(r=>r.symbol)).size!==rows.length)throw Error('Duplicate Phoenix position');
  return {account:'Phoenix:'+index+':'+sub,venue:'Phoenix',address,index,subaccountIndex:sub,at,revision:String(data.slot),ok:true,rows};
 });
}
function withHistory(accounts,data,now=Date.now()){
 if(!Array.isArray(data?.data)||typeof data.hasMore!=='boolean')throw Error('Invalid Phoenix fill history');
 const seen=new Set();
 for(const r of data.data){
  if(!r.fillId||seen.has(r.fillId))throw Error('Duplicate or missing Phoenix fill ID');
  seen.add(r.fillId);
  if(!Number.isInteger(r.traderPdaIndex)||!Number.isInteger(r.subaccountIndex)||typeof r.marketSymbol!=='string')throw Error('Invalid Phoenix fill identity');
 }
 for(const a of accounts)for(const row of a.rows){
  const fills=data.data.filter(r=>r.traderPdaIndex===a.index&&r.subaccountIndex===a.subaccountIndex&&r.marketSymbol===row.symbol).sort((x,y)=>y.slot-x.slot||y.slotIndex-x.slotIndex||y.instructionIndex-x.instructionIndex||y.eventIndex-x.eventIndex);
  let expected=(row.side==='LONG'?1:-1)*row.quantity;
  for(const r of fills){
   const before=num(r.baseLotsBefore),after=num(r.baseLotsAfter),delta=num(r.baseLotsDelta),time=Date.parse(r.timestamp);
   // This history endpoint reports decimal underlying units despite its Lots field names.
   if(![r.slot,r.slotIndex,r.instructionIndex,r.eventIndex].every(Number.isSafeInteger)||r.slot>Number(a.revision)||!near(after,expected)||!near(after-before,delta)||!Number.isFinite(time)||time<=0||time>now+5000||Math.sign(after)!==Math.sign(expected))break;
   if(before===0||Math.sign(before)!==Math.sign(after)){
    row.enteredAt=time;row.generation=String(r.fillId);break;
   }
   expected=before;
  }
 }
 return accounts;
}
async function blockTime(slot){
 try{return await Sol.blockTime(slot);}catch(e){throw Error('Phoenix snapshot time unavailable',{cause:e});}
}
async function fetchAccounts(config){
 const {address,index=0,subaccounts=[0]}=config;
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)||!Number.isInteger(index)||index<0||!Array.isArray(subaccounts)||!subaccounts.length||subaccounts.some(s=>!Number.isInteger(s)||s<0)||new Set(subaccounts).size!==subaccounts.length)throw Error('Invalid Phoenix wallet configuration');
 const unavailable=()=>subaccounts.map(sub=>({account:'Phoenix:'+index+':'+sub,venue:'Phoenix',at:Date.now(),ok:false,rows:[]}));
 let stage='account/market snapshots';
 try{
  const [data,markets]=await Promise.all([D.get(BASE+'/v1/trader/state/'+address+'?traderPdaIndex='+index),D.get(BASE+'/v1/exchange/snapshot')]);
  stage='Solana slot timestamp';
  const at=await blockTime(data.slot);
  stage='position validation';
  const accounts=parse(data,markets,address,index,subaccounts,at);
  if(accounts.some(a=>a.rows.length)){
   const rows=[],cursors=new Set();let cursor;
   for(let page=0;page<5;page++){
    const q=new URLSearchParams({pdaIndex:String(index),limit:'100'});if(cursor)q.set('cursor',cursor);
    stage='fill history request';
    const history=await D.get(BASE+'/v1/trader/'+address+'/trades-history?'+q);
    stage='fill history validation';
    if(!Array.isArray(history.data)||typeof history.hasMore!=='boolean')throw Error('Incomplete Phoenix history response');
    rows.push(...history.data);
    withHistory(accounts,{data:rows,hasMore:history.hasMore});
    if(accounts.every(a=>a.rows.every(r=>r.generation))||!history.hasMore)break;
    if(!history.nextCursor||cursors.has(history.nextCursor))throw Error('Invalid Phoenix history pagination');
    cursor=history.nextCursor;cursors.add(cursor);
   }
  }
  return accounts;
 }catch(e){console.warn('Phoenix wallet check unavailable: '+stage+' ('+Log.safe(e)+'). Freshness checks remain enforced; no closure inferred.');return unavailable();}
}
module.exports={parse,withHistory,fetchAccounts};
