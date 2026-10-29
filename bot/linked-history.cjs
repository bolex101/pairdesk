'use strict';
const num=v=>typeof v==='number'||typeof v==='string'&&v.trim()!==''?Number(v):NaN;
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-9,Math.abs(b)*1e-7);
function reconstruct(snapshot,fills,now=Date.now()){
 if(!Array.isArray(fills))throw Error('Fill history missing');
 const ids=new Set();
 for(const f of fills){
 if(typeof f.id!=='string'||!f.id||ids.has(f.id)||!f.symbol||!['BUY','SELL'].includes(f.side)||!(f.size>0)||!(f.price>0)||![f.size,f.price,f.at].every(Number.isFinite)||f.at<=0||f.at>now+5000)throw Error('Invalid or duplicate fill');
 ids.add(f.id);
 }
 for(const row of snapshot.rows){
 row.enteredAt=null;row.generation=null;
 const list=fills.filter(f=>f.symbol===row.symbol).sort((a,b)=>b.at-a.at||b.id.localeCompare(a.id));
 let expected=(row.side==='LONG'?1:-1)*row.quantity,chain=[];
 for(let i=0;i<list.length;i++){
 const f=list[i];
 // Opposing fills sharing a timestamp have an unknown execution order.
 if(list.some(g=>g!==f&&g.at===f.at&&g.side!==f.side))break;
 const delta=(f.side==='BUY'?1:-1)*f.size,before=expected-delta;chain.push(f);
 if(near(before,0)||Math.sign(before)!==Math.sign(expected)){
 if(Math.sign(delta)!==Math.sign(expected))break;
 let quantity=near(before,0)?0:before,avg=0;
 for(const g of [...chain].reverse()){
 const d=(g.side==='BUY'?1:-1)*g.size,next=quantity+d;
 if(near(quantity,0)||Math.sign(next)!==Math.sign(quantity))avg=g.price;
 else if(Math.sign(d)===Math.sign(quantity))avg=(Math.abs(quantity)*avg+g.size*g.price)/Math.abs(next);
 quantity=next;
 }
 if(near(quantity,(row.side==='LONG'?1:-1)*row.quantity)&&near(avg,row.price)){row.enteredAt=f.at;row.generation=f.id;}
 break;
 }
 expected=before;
 }
 }
 return snapshot;
}
const exposure=s=>JSON.stringify(s.rows.map(r=>[r.symbol,r.side,r.quantity,r.price]).sort((a,b)=>a[0].localeCompare(b[0])));
module.exports={num,near,reconstruct,exposure};
