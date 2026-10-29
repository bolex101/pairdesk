'use strict';
const Risk=require('./risk.cjs'),H=require('./linked-history.cjs'),X=require('./extra-venues.cjs'),ROOT='https://api.rise.trade';
const addressOK=w=>/^0x[a-fA-F0-9]{40}$/.test(w);
async function get(route){
 let r;try{r=await fetch(ROOT+route,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});}catch{throw Error('RISEx account connection unavailable');}
 if(!r.ok)throw Error('RISEx account HTTP '+r.status);
 const date=Date.parse(r.headers.get('date'));if(!Number.isFinite(date)||Math.abs(Date.now()-date)>120000)throw Error('RISEx response time unverified');
 return r.json();
}
function parse(data,address,now=Date.now()){
 const d=data?.data;if(!addressOK(address)||d?.account?.toLowerCase()!==address.toLowerCase()||!Array.isArray(d.positions))throw Error('RISEx portfolio identity/schema invalid');
 const rows=[];
 for(const r of d.positions){
 const signed=H.num(r.size);if(!Number.isFinite(signed))throw Error('RISEx invalid size');if(!signed)continue;
 const price=H.num(r.avg_entry_price),mark=H.num(r.mark_price),pnl=H.num(r.unrealized_pnl);
 if(!/^[A-Z0-9]+\/USDC$/.test(r.market_name)||!/^\d+$/.test(r.market_id)||![0,1].includes(r.side)||r.side!==(signed>0?0:1)||!(price>0)||!Number.isFinite(price*signed)||!(mark>0)||!Number.isFinite(pnl)||Math.abs((mark-price)*signed-pnl)>Math.max(.02,Math.abs(pnl)*.001))throw Error('RISEx position units, side or price unverified');
 rows.push(Risk.withLiquidation({symbol:r.market_name.replace('/','-'),marketId:r.market_id,side:signed>0?'LONG':'SHORT',quantity:Math.abs(signed),price,enteredAt:null,generation:null},r));
 }
 if(new Set(rows.map(r=>r.symbol)).size!==rows.length)throw Error('RISEx duplicate market position');
 return {account:'RISEx',venue:'RISEx',address,at:now,ok:true,rows};
}
function trades(data,address,page,snapshot){
 const d=data?.data;
 if(d?.wallet_address?.toLowerCase()!==address.toLowerCase()||d.page!==page||typeof d.has_next_page!=='boolean'||!Array.isArray(d.trades)||String(d.market_id)!=='0')throw Error('RISEx fills identity/pagination invalid');
 const mapping=new Map(snapshot.rows.map(r=>[r.marketId,r.symbol]));
 return {more:d.has_next_page,rows:d.trades.filter(f=>mapping.has(f.market_id)).map(f=>({id:f.id,symbol:mapping.get(f.market_id),side:f.side,size:H.num(f.size),price:H.num(f.price),at:X.nsMs(f.time)}))};
}
async function fetchAccount(address){
 if(!addressOK(address))throw Error('Invalid RISEx address');
 const route='/v1/portfolio/details?'+new URLSearchParams({account:address}),start=Date.now();
 const account=parse(await get(route),address,start);
 if(account.rows.length){
 const all=[];
 for(let page=1;page<=3;page++){
 const result=trades(await get('/v1/trade-history?'+new URLSearchParams({account:address,limit:'1000',page:String(page),sorted_by:'-time'})),address,page,account);
 all.push(...result.rows);H.reconstruct(account,all);
 if(account.rows.every(r=>r.generation)||!result.more)break;
 }
 const after=parse(await get(route),address);
 if(H.exposure(account)!==H.exposure(after))throw Error('RISEx position changed during history read');
 }
 return account;
}
module.exports={parse,trades,fetchAccount};
