const Log=require('./log.cjs');
const fs=require('node:fs'),path=require('node:path'),C=require('./positions.cjs'),Store=require('./storage.cjs'),W=require('./wallet-sync.cjs'),L=require('./wallet-link.cjs'),Feeds=require('./monitor-feeds.cjs'),WF=require('./wallet-feeds.cjs'),PF=require('./phoenix-wallet.cjs'),OF=require('./ondo-wallet.cjs');
const ID=/^[1-9]\d{0,15}$/,venues=['Popdex','Arcus','Phoenix','Ondo','RISEx'];
const HELP='PRIVATE FRIEND MONITORING\n/open SIGNAL_ID — register fills\n/wallet VENUE ADDRESS — add a public wallet (Popdex, Arcus, Phoenix, Ondo or RISEx)\n/wallets — your wallet sync\n/link SIGNAL_ID — link existing wallet legs\n/positions — your trades only\n/close POSITION_ID — stop monitoring after closing both legs\n/cancel — cancel registration\n/status — your monitor status\nQFEX: ask the owner to install your separate view-only key. Never send API secrets or seed phrases here. No orders placed.';
function members(s){s.community??={version:1,members:{}};if(s.community.version!==1||!s.community.members)throw Error('Invalid friend registry');return s.community.members;}
function plan(dir,id){
 if(!/^[a-f0-9]{12}$/.test(id)||!fs.existsSync(path.join(dir,'shared-signals',id+'.json')))return null;
 const p=Store.loadSignal(dir,id);if(!p?.ready)return null;
 const out={};for(const k of ['ready','venue','beta','alpha','sd','tpZ','stopZ','maxHoldMinutes','createdAt','expiresAt'])out[k]=p[k];
 out.a={id:p.a.id,side:p.a.side};out.b={id:p.b.id,side:p.b.side};return out;
}
function plans(dir){const folder=path.join(dir,'shared-signals');return fs.existsSync(folder)?fs.readdirSync(folder).filter(f=>/^[a-f0-9]{12}\.json$/.test(f)).flatMap(f=>{try{const p=plan(dir,f.slice(0,12));return p?[{id:f.slice(0,12),plan:p}]:[];}catch(e){Log.warn('Skipping unreadable shared signal '+f,e);return [];}}):[];}
function admin(s,text,reply,now=Date.now()){
 const args=text.split(/\s+/),action=args[0];
 if(!['/friends','/approve','/revoke'].includes(action))return false;
 const all=members(s);
 if(action==='/friends'){reply(Object.entries(all).map(([id,m])=>id+' — '+m.status+' — '+m.name).join('\n')||'No friend requests yet. Friends can send /start to @pairdeskbot.');return true;}
 const id=args[1],m=all[id];
 if(args.length!==2||!ID.test(id||'')||!m){reply('Use '+action+' TELEGRAM_USER_ID from /friends.');return true;}
 if(action==='/approve'){
  if(m.status==='approved'){reply('Already approved.');return true;}
  if(Object.values(all).filter(m=>m.status==='approved').length>=10){reply('Initial capacity is 10 approved friends. Revoke an inactive member before approving another.');return true;}
  m.status='approved';m.epoch=(m.epoch||0)+1;m.state.outbox=[];m.state.draft=null;
  C.queue(m.state,'approval-'+now,'Access approved. Tap Register my trade on the channel alert again to choose a signal. Your registered trades and monitoring messages stay in this private chat.\n'+HELP);
  reply('Approved '+id+'. They can now register their own wallets and trades.');
 }else{
  m.status='revoked';m.epoch=(m.epoch||0)+1;m.state.outbox=[];m.state.draft=null;m.state.walletLinkDraft=null;
  C.queue(m.state,'revoked-'+now,'Access revoked. Your monitoring is paused. Existing exchange positions have NOT been closed; manage them directly.');
  reply('Revoked '+id+'. Friend monitoring stopped; no exchange positions closed.');
 }
 return true;
}
function same(a,b){return a?.startsWith('0x')&&b?.startsWith('0x')?a.toLowerCase()===b.toLowerCase():a===b;}
function occupied(s,id,address,owner){
 const ownerAddresses=[owner.address,owner.phoenix?.address,owner.risex?.address];
 return ownerAddresses.some(a=>a&&same(a,address))||Object.entries(members(s)).some(([other,m])=>other!==id&&Object.values(m.wallets||{}).some(w=>same(w.address,address)));
}
function command(s,m,id,text,reply,dir,owner,now){
 if(text==='/start'||text==='/help'){reply(HELP);return true;}
 if(/^\/(approve|revoke|friends)(\s|$)/.test(text)){reply('Only the bot owner can manage approvals.');return true;}
 if(text==='/status'){reply('Your monitoring profile is approved. Open positions: '+Object.values(m.state.positions).filter(p=>!p.closedAt).length+'. Last completed check: '+(m.state.lastCycle?new Date(m.state.lastCycle).toISOString():'pending')+'. Checks are periodic and may be delayed by API outages or other friend checks. /positions shows your latest observations. No orders placed.');return true;}
 if(text==='/performance'){reply('Personal performance reporting is not included. Use /positions for your monitored positions.');return true;}
 if(/^\/wallet\s+qfex(?:\s|$)/i.test(text)){reply('QFEX primary-account linking requires the owner to run the separate encrypted-key setup for your approved Telegram ID. Never send keys here.');return true;}
 if(/^\/wallet(?:\s|$)/.test(text)){
  const args=text.split(/\s+/),venue=venues.find(v=>v.toLowerCase()===args[1]?.toLowerCase()),address=args[2];
  const valid=venue==='Phoenix'?/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address||''):/^0x[a-fA-F0-9]{40}$/.test(address||'');
  if(args.length!==3||!venue||!valid){reply('Use /wallet Popdex 0xADDRESS, /wallet Arcus 0xADDRESS, /wallet Ondo 0xADDRESS /wallet RISEx 0xADDRESS or /wallet Phoenix SOLANA_ADDRESS. Public addresses only.');return true;}
  if(occupied(s,id,address,owner)){reply('That address cannot be registered to this profile. Ask the owner to review access.');return true;}
  if(m.wallets[venue]&&!same(m.wallets[venue].address,address)){reply('This venue already has a wallet. Ask the owner before replacing it; existing linked trades must be resolved first.');return true;}
  if(!m.wallets[venue])m.wallets[venue]={address,enabled:venue!=='Ondo'};
  reply(venue==='Ondo'?'Ondo address saved. A separate view-only key must be installed through the server setup by the owner. Do NOT send it here.':'Public wallet saved for '+venue+'. Matching uses only channel-published signals. /wallets shows sync health; unmatched positions are not monitored.');
  return true;
 }
 if(text==='/wallets'){reply(W.status(m.state)+'\nConfigured venues: '+Object.keys(m.wallets).join(', ')+'\nOndo: '+(m.wallets.Ondo?.enabled?'enabled':'not enabled'));return true;}
 if(L.command(m.state,text,reply,id=>plan(dir,id),Object.values(m.wallets).some(w=>w.enabled),now))return true;
 return false;
}
function handle(s,u,ownerId,dir,owner,now=Date.now()){
 if(!Number.isSafeInteger(u.update_id)||u.update_id<s.offset)return true;
 const raw=u.callback_query?.message||u.message,from=u.callback_query?.from||u.message?.from;
 if(String(from?.id)===String(ownerId)){if(!u.callback_query&&/^\/start trade_[a-f0-9]{12}$/.test(raw?.text||''))u.message={...raw,text:'/open '+raw.text.split('trade_')[1]};return false;}
 s.offset=u.update_id+1;
 if(raw?.chat?.type!=='private'||String(raw.chat.id)!==String(from?.id)||from?.is_bot||!ID.test(String(from?.id)))return true;
 const id=String(from.id),all=members(s);let m=all[id];
 if(!m){
  if(u.callback_query||typeof raw.text!=='string'||!/^\/start(?:\s|$)/.test(raw.text)||!Number.isFinite(raw.date)||now-raw.date*1000>600000||raw.date*1000>now+60000||Object.keys(all).length>=100)return true;
  m=all[id]={status:'pending',name:String(from.first_name||'Friend').replace(/[\r\n]/g,' ').slice(0,60),epoch:0,wallets:{},state:C.initial()};
  C.queue(m.state,'request-'+u.update_id,'Access requested. The owner must approve you before wallets or trades can be registered. Never send secrets here.');
  C.queue(s,'friend-request-'+id,'FRIEND ACCESS REQUEST\n'+m.name+'\nTelegram ID: '+id+'\nApprove: /approve '+id+'\nDecline/revoke: /revoke '+id);
  return true;
 }
 if(m.status!=='approved')return true;
 let update=u;
 if(!u.callback_query&&/^\/start trade_[a-f0-9]{12}$/.test(raw.text||''))update={...u,message:{...raw,text:'/open '+raw.text.split('trade_')[1]}};
 C.handle(m.state,update,id,signal=>plan(dir,signal),now,(text,reply)=>command(s,m,id,text,reply,dir,owner,now));
 return true;
}
async function snapshots(m,id){
 const out=[];
 for(const [venue,w] of Object.entries(m.wallets)){
  if(!w.enabled)continue;
  if(venue==='Popdex'||venue==='Arcus'){
   const results=await WF.fetchAccounts({enabled:true,address:w.address,popdex:venue==='Popdex',arcusAccountIndices:venue==='Arcus'?[0,1,2,3,4,5,6,7,8,9]:[]});
   out.push(...results);
  }else if(venue==='Phoenix')out.push(...await PF.fetchAccounts({address:w.address,index:0,subaccounts:[0,1]}));
  else if(venue==='RISEx'){try{out.push(await require('./risex-wallet.cjs').fetchAccount(w.address));}catch(e){Log.warn('Friend RISEx wallet check unavailable',e);out.push({account:'RISEx',venue:'RISEx',ok:false,at:Date.now(),rows:[]});}}
  else if(venue==='QFEX'){try{const Q=require('./qfex-wallet.cjs');out.push(await Q.fetchAccount(w,Q.credentials('qfex-friend-'+id)));}catch(e){Log.warn('Friend QFEX wallet check unavailable',e);out.push({account:'QFEX',venue:'QFEX',ok:false,at:Date.now(),rows:[]});}}
  else if(venue==='Ondo'){
   try{
    if(!process.env.CREDENTIALS_DIRECTORY)throw Error('Missing friend credentials');
    const key=JSON.parse(fs.readFileSync(path.join(process.env.CREDENTIALS_DIRECTORY,'ondo-friend-'+id),'utf8'));
    out.push(await OF.fetchAccount(w.address,key));
   }catch(e){Log.warn('Friend Ondo wallet check unavailable',e);out.push({account:'Ondo',venue:'Ondo',ok:false,at:Date.now(),rows:[]});}
  }
 }
 return out;
}
function runner(s,save,bot,dir){
 const active=new Set(),due=new Map();
 async function flush(m,id,epoch){
  for(const e of m.state.outbox.slice(0,5)){
   if(m.epoch!==epoch)return;
   await bot.api('sendMessage',{chat_id:id,text:e.text+'\nEvent '+e.id,...(e.replyMarkup?{reply_markup:e.replyMarkup}:{})});
   m.state.outbox=m.state.outbox.filter(x=>x.id!==e.id);save();
  }
 }
 async function work(m,id){
  const epoch=m.epoch,valid=()=>m.status==='approved'&&m.epoch===epoch;
  try{
   await flush(m,id,epoch);
   if(!valid()||Date.now()<(due.get(id)||0))return;
   due.set(id,Date.now()+30000);
   let open=Object.values(m.state.positions).filter(p=>!p.closedAt);
   for(const p of open)C.evaluate(m.state,p,null,Date.now(),false);
   save();await flush(m,id,epoch);
   const snaps=await snapshots(m,id);if(!valid())return;
   W.reconcile(m.state,snaps,plans(dir),C.queue,Date.now());
   open=Object.values(m.state.positions).filter(p=>!p.closedAt);
   const lookup=await Feeds.quotes(open.filter(p=>!p.walletSuspended));if(!valid())return;
   for(const p of open)C.evaluate(m.state,p,lookup(p),Date.now());
   m.state.lastCycle=Date.now();save();await flush(m,id,epoch);
  }catch(e){console.error('Friend monitoring/delivery unavailable; will retry. No credentials displayed. ('+Log.safe(e)+')');}
  finally{active.delete(id);}
 }
 return ()=>{
  for(const [id,m] of Object.entries(members(s)).sort((a,b)=>(due.get(a[0])||0)-(due.get(b[0])||0))){
   if(active.size>=2)break;
   if(active.has(id)||!m.state.outbox.length&&(m.status!=='approved'||Date.now()<(due.get(id)||0)))continue;
   active.add(id);void work(m,id);
  }
 };
}
module.exports={members,admin,handle,plan,plans,occupied,runner,snapshots,HELP};
