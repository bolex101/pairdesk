const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,16);
const key=r=>r.symbol+':'+r.side;
// Liquidation prices move with funding/marks; they must not make a snapshot look unstable.
const core=rows=>rows.map(({liquidationPrice,...r})=>r);
const fresh=(x,now)=>x?.ok&&now-x.at<=120000&&x.at<=now+5000;
function plans(dir){
 const folder=path.join(dir,'signals');if(!fs.existsSync(folder))return [];
 return fs.readdirSync(folder).filter(f=>/^[a-f0-9]{12}\.json$/.test(f)).flatMap(f=>{
  try{const p=JSON.parse(fs.readFileSync(path.join(folder,f),'utf8'));return valid(p)?[{id:f.slice(0,12),plan:p}]:[];}catch{return [];}
 });
}
function valid(p){return p?.ready&&['Arcus','Popdex','Phoenix','Ondo','QFEX','RISEx'].includes(p.venue)&&p.a?.id!==p.b?.id&&[p.a,p.b].every(l=>typeof l?.id==='string'&&['LONG','SHORT'].includes(l.side))&&p.a.side!==p.b.side&&[p.beta,p.alpha,p.sd,p.tpZ,p.stopZ,p.maxHoldMinutes,p.createdAt,p.expiresAt].every(Number.isFinite)&&p.beta>0&&p.sd>0&&p.maxHoldMinutes>0;}
function legs(p,x){return [p.a,p.b].map(l=>x.rows.find(r=>r.symbol===l.id&&r.side===l.side));}
function known(rows){return rows.every(r=>r&&r.generation&&Number.isFinite(r.enteredAt));}
function eligible(p,rows){return known(rows)&&rows.every(r=>r.enteredAt>=p.createdAt-60000&&r.enteredAt<=p.expiresAt+60000)&&Math.abs(rows[0].enteredAt-rows[1].enteredAt)<=600000;}
function identity(account,rows){return hash([account,...rows.map(r=>[key(r),r.generation]).sort((a,b)=>a[0].localeCompare(b[0]))]);}
function reconcile(s,snapshots,saved,queue,now=Date.now()){
 s.wallets??={accounts:{},notices:{}};
 const state=s.wallets;
 const notice=(id,text)=>{if(state.notices[id])return;state.notices[id]=now;queue(s,'wallet:'+id,text);};
 const oldAccounts=state.accounts;
 state.health??={};
 for(const x of snapshots){
  const prior=oldAccounts[x.account];
  // One duplicate identity makes the entire account snapshot ambiguous.
  if(x.ok&&new Set(x.rows.map(key)).size!==x.rows.length)x.ok=false;
  x.stable=!!(fresh(x,now)&&fresh(prior,now)&&x.at>prior.at&&(x.venue!=='Phoenix'||x.revision!==prior.revision)&&hash(core(x.rows))===hash(core(prior.rows)));
  x.previous=prior?{ok:prior.ok,at:prior.at,revision:prior.revision}:null;
  state.accounts[x.account]=x;
  const monitored=Object.values(s.positions).some(p=>!p.closedAt&&p.wallet?.account===x.account);
  const h=state.health[x.account]??={reported:false,lastWarning:0,goodSince:null};
  if(!fresh(x,now)){
   h.goodSince=null;
   if(monitored&&(!h.lastWarning||now-h.lastWarning>=3600000)){
    h.lastWarning=now;h.reported=true;
    notice(x.account+':unavailable:'+now,'WALLET SYNC UNAVAILABLE — '+x.account+'\nAccount data could not be verified. Linked z checks are paused; time-limit checks continue. No positions were marked closed.');
   }
  }else{
   if(h.goodSince===null)h.goodSince=now;
   const advancing=prior&&fresh(prior,now)&&x.at>prior.at&&(x.venue!=='Phoenix'||x.revision!==prior.revision);
   if(monitored&&h.reported&&advancing&&now-h.goodSince>=60000){
    notice(x.account+':recovered:'+now,'Wallet sync resumed for '+x.account+' after at least one minute of successful checks. Crossings during the gap may have been missed.');
    h.reported=false;
   }
  }
  if(!monitored)h.reported=false;
 }
 const active=()=>Object.values(s.positions).filter(p=>!p.closedAt);
 const claimed=(account,r,except)=>active().some(p=>p.id!==except&&p.wallet?.account===account&&p.wallet.legs.some(l=>key(l)===key(r)));
 function bind(p,x,rows){
  p.wallet={account:x.account,identity:identity(x.account,rows),legs:rows.map(r=>({symbol:r.symbol,side:r.side,generation:r.generation}))};
  update(p,rows);p.walletSuspended=false;
  notice('linked:'+p.id,'WALLET TRACKING ACTIVE\n'+p.id+': '+x.account+' '+p.plan.a.id+' / '+p.plan.b.id+'\nActual sizes and average entry prices are synced. Saved pair targets and time limit remain fixed. P&L covers remaining open size only, excluding realized partial exits, fees and funding. No orders placed.');
 }
 function update(p,rows){p.priceA=rows[0].price;p.priceB=rows[1].price;p.notionalA=rows[0].price*rows[0].quantity;p.notionalB=rows[1].price*rows[1].quantity;
  const liq={a:rows[0].liquidationPrice??null,b:rows[1].liquidationPrice??null};if(liq.a||liq.b)p.liquidation=liq;else delete p.liquidation;}
 // Attach an existing manual registration only when both its account and its legs are unique.
 for(const p of active().filter(p=>!p.wallet&&valid(p.plan))){
  const candidates=snapshots.filter(x=>fresh(x,now)&&x.stable&&x.venue===p.plan.venue).map(x=>({x,rows:legs(p.plan,x)})).filter(c=>eligible(p.plan,c.rows)&&c.rows.every(r=>!claimed(c.x.account,r)));
  if(candidates.length===1){const {x,rows}=candidates[0];const overlap=active().some(q=>q.id!==p.id&&q.plan.venue===p.plan.venue&&[q.plan.a,q.plan.b].some(l=>rows.some(r=>r.symbol===l.id&&r.side===l.side)));if(!overlap)bind(p,x,rows);}
 }
 for(const p of active().filter(p=>p.wallet)){
  const x=state.accounts[p.wallet.account];
  if(!fresh(x,now)){p.walletSuspended=true;p.walletMissing=null;continue;}
  const rows=legs(p.plan,x),exact=rows.map((r,i)=>r&&r.generation===p.wallet.legs[i].generation);
  if(exact.every(Boolean)){
   const before=hash([p.priceA,p.priceB,p.notionalA,p.notionalB]),wasPaused=p.walletSuspended;
   update(p,rows);p.walletSuspended=false;p.walletMissing=null;
   if(before!==hash([p.priceA,p.priceB,p.notionalA,p.notionalB]))notice('size:'+p.id+':'+now,'POSITION SIZE UPDATED\n'+p.id+' — '+rows.map(r=>r.symbol+' '+r.quantity+' @ '+r.price).join('; ')+'\nTargets and deadline unchanged. P&L now covers remaining open size; realized exits excluded.');
   // Account-level recovery notices are rate-limited and wait for sustained health.
  }else{
   p.walletSuspended=true;p.last=null;
   // Unknown generation is not proof of closure. A new generation is a different trade.
   const absent=rows.every((r,i)=>!r||(r.generation&&r.generation!==p.wallet.legs[i].generation));
   const prev=p.walletMissing;
   if(absent){
    if(prev&&x.at>prev.at&&x.at-prev.at>=15000&&x.previous?.ok&&(!['Popdex','Phoenix'].includes(x.venue)||x.revision!==prev.revision)){
     p.closedAt=now;p.closedReason='Both original wallet legs absent in two verified snapshots';
     s.outbox=s.outbox.filter(e=>!e.id.startsWith(p.id+':'));
     notice('closed:'+p.id,'EXCHANGE CLOSURE DETECTED\n'+p.id+' — both original legs are no longer open. Monitoring stopped. No orders were sent.');
    }else if(!prev)p.walletMissing={at:x.at,revision:x.revision};
   }else p.walletMissing=null;
   if(!p.closedAt)notice('mismatch:'+p.id+':'+hash(rows),'PAIR MONITORING PAUSED\n'+p.id+' — one or both original legs are missing, replaced, or cannot be identified. Check your exchange. TP/stop checks are paused; time-limit checks continue.');
  }
 }
 // New registrations require a unique saved signal and stable observed exposure.
 const candidates=[];
 for(const x of snapshots.filter(x=>fresh(x,now)&&x.stable))for(const item of saved){
  if(!valid(item.plan)||item.plan.venue!==x.venue)continue;
  const rows=legs(item.plan,x);if(!eligible(item.plan,rows)||rows.some(r=>claimed(x.account,r)))continue;
  if(active().some(p=>p.plan.venue===x.venue&&[p.plan.a,p.plan.b].some(l=>rows.some(r=>r.symbol===l.id&&r.side===l.side))))continue;
  const id=identity(x.account,rows);
  if(Object.values(s.positions).some(p=>p.wallet?.identity===id))continue;
  candidates.push({x,rows,item,id});
 }
 for(const c of candidates){
  if(candidates.some(d=>d!==c&&d.x.account===c.x.account&&d.rows.some(r=>c.rows.some(t=>key(t)===key(r)))))continue;
  if(active().length>=10)break;
  const enteredAt=Math.min(...c.rows.map(r=>r.enteredAt)),id='w'+c.id;
  const p={id,signalId:c.item.id,plan:JSON.parse(JSON.stringify(c.item.plan)),enteredAt,deadline:enteredAt+c.item.plan.maxHoldMinutes*60000,registeredAt:now,notified:{},last:null,staleSince:null};
  s.positions[id]=p;bind(p,c.x,c.rows);
 }
 for(const x of snapshots.filter(x=>fresh(x,now)&&x.stable)){
  const unmatched=x.rows.filter(r=>!claimed(x.account,r)&&!Object.values(s.positions).some(p=>p.closedAt&&p.wallet?.account===x.account&&p.wallet.legs.some(l=>key(l)===key(r)&&l.generation===r.generation)));
  if(unmatched.length)notice('unmatched:'+x.account+':'+hash(unmatched.map(r=>[key(r),r.generation])),'UNMATCHED WALLET POSITIONS — '+x.account+'\n'+unmatched.map(r=>r.side+' '+r.symbol).join('\n')+'\nNo unique saved Pairdesk signal could be verified for these legs. They are not automatically monitored. Use Register trade on the alert you traded, or /open SIGNAL_ID, to register manually. Use /positions to check active tracking.');
 }
}
function status(s,now=Date.now()){
 if(!s.wallets)return 'Wallet sync has not completed its first check.';
 const accounts=Object.values(s.wallets.accounts),pop=accounts.filter(x=>x.venue==='Popdex'),arc=accounts.filter(x=>x.venue==='Arcus');
 const phoenix=accounts.filter(x=>x.venue==='Phoenix'),ondo=accounts.filter(x=>x.venue==='Ondo');
 const lines=[['Popdex',pop],['Arcus',arc],...(phoenix.length?[['Phoenix',phoenix]]:[]),...(ondo.length?[['Ondo',ondo]]:[]),...['QFEX','RISEx'].map(v=>[v,accounts.filter(x=>x.venue===v)]).filter(([v,rows])=>rows.length)].map(([name,rows])=>name+': '+rows.filter(x=>fresh(x,now)).length+'/'+rows.length+' accounts verified; '+rows.filter(x=>fresh(x,now)).reduce((n,x)=>n+x.rows.length,0)+' open legs');
 const linked=Object.values(s.positions).filter(p=>!p.closedAt&&p.wallet);
 return ['READ-ONLY WALLET SYNC',...lines,'Linked pairs: '+linked.length+'; paused: '+linked.filter(p=>p.walletSuspended).length,'Arcus account indices 0–9 are checked. /positions shows registered pairs. Unmatched legs have no automatic TP/stop targets. No orders placed.'].join('\n');
}
module.exports={reconcile,status,plans,valid};
