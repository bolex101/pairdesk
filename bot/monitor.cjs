const Log=require('./log.cjs');
const Config=require('./config.cjs'),fs=require('node:fs'),path=require('node:path'),Core=require('./positions.cjs'),Store=require('./storage.cjs'),Feeds=require('./monitor-feeds.cjs'),Telegram=require('./telegram.cjs'),Wallet=require('./wallet-sync.cjs'),WalletFeeds=require('./wallet-feeds.cjs'),Performance=require('./performance.cjs'),WalletLink=require('./wallet-link.cjs');
const dir=process.env.PAIRDESK_STATE_DIR||path.join(__dirname,'state'),chat=process.env.TELEGRAM_CHAT_ID;
fs.mkdirSync(dir,{recursive:true,mode:0o700});
const file=path.join(dir,'positions.json'),bot=Telegram.client(process.env.TELEGRAM_BOT_TOKEN,chat);
const s=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):Core.initial();
if(s.version!==1||!s.positions||!Array.isArray(s.outbox)||!Number.isSafeInteger(s.offset))throw Error('Invalid position state; not resetting');
const configFile=process.env.PAIRDESK_WALLET_CONFIG||path.join(__dirname,'wallet-config.json');
const walletConfig=fs.existsSync(configFile)?JSON.parse(fs.readFileSync(configFile,'utf8')):{enabled:false};
const save=()=>Store.save(file,s);
const Friends=require('./friends.cjs'),Identity=require('./identity.cjs'),Heartbeat=require('./heartbeat.cjs');
// Dead-man check on the scanner: alert via the normal outbox if status.json goes stale.
function watchScanner(now){
 const last=Heartbeat.scannerLastRun(dir),limit=Config.get().heartbeatStaleMinutes;
 s.heartbeat??={};const r=Heartbeat.evaluate(s.heartbeat.scanner,last,now,limit);s.heartbeat.scanner=r.entry;
 if(r.event)Core.queue(s,'heartbeat:scanner:'+r.event+':'+now,Heartbeat.message('scanner',r,last,limit));
}
const pumpFriends=Friends.runner(s,save,bot,dir);
async function flush(){
 for(const event of s.outbox.slice(0,10)){
  try{await bot.send(event.text+'\nEvent '+event.id,event.replyMarkup);}
  catch(e){console.error('Notification pending; delivery will retry ('+Log.safe(e)+')');break;}
  s.outbox=s.outbox.filter(e=>e.id!==event.id);save();
 }
}
(async()=>{
 const me=await bot.api('getMe'),hook=await bot.api('getWebhookInfo');
 if(me.username?.toLowerCase()!==Identity.username()||hook.url)throw Error('Unexpected bot or existing webhook');
 save();console.log('Position monitor ready; owner monitoring and approved private friend profiles enabled.');
 let nextCheck=0;
 for(;;){
  const now=Date.now();
  if(now>=nextCheck){
   let open=Object.values(s.positions).filter(p=>!p.closedAt);
   // Persist and deliver overdue time notifications before any potentially slow market requests.
   for(const p of open)Core.evaluate(s,p,null,now,false);
   save();await flush();
   if(walletConfig.enabled){
    const snapshots=await WalletFeeds.fetchAccounts(walletConfig);
    Wallet.reconcile(s,snapshots,Wallet.plans(dir),Core.queue,Date.now());
    open=Object.values(s.positions).filter(p=>!p.closedAt);
    save();await flush();
   }
   Performance.ingest(s,dir,Date.now());
   const paper=Performance.open(s);
   save();
   const lookup=await Feeds.quotes([...open.filter(p=>!p.walletSuspended),...paper]);
   for(const r of paper)Performance.observe(s,r,lookup(r),Date.now());
   for(const p of open)Core.evaluate(s,p,lookup(p),Date.now());
   s.lastCycle=Date.now();watchScanner(s.lastCycle);save();await flush();
   nextCheck=Date.now()+30000;
   console.log('Monitor cycle complete: '+open.length+' registered open trades');
  }
  pumpFriends();
  try{
   const updates=await bot.api('getUpdates',{offset:s.offset,timeout:10,limit:50,allowed_updates:['message','callback_query']});
   for(const u of updates){
    if(!Friends.handle(s,u,chat,dir,walletConfig))Core.handle(s,u,chat,id=>Store.loadSignal(dir,id),Date.now(),(text,reply)=>{if(Friends.admin(s,text,reply))return true;if(text==='/help'||text==='/start'){reply(Core.HELP+'\n\nOWNER ACCESS CONTROLS\n/friends — requests and approvals\n/approve USER_ID — approve friend\n/revoke USER_ID — revoke and pause friend monitoring');return true;}if(WalletLink.command(s,text,reply,id=>Store.loadSignal(dir,id),walletConfig.enabled,Date.now()))return true;if(text==='/performance'||text.startsWith('/performance ')){const name=text.split(/\s+/)[1],venue=['Popdex','Arcus','Variational','Ondo','Phoenix','QFEX','RISEx'].find(v=>v.toLowerCase()===name?.toLowerCase());reply(name&&!venue?'Use /performance, /performance Popdex, /performance Arcus, /performance Variational, /performance Ondo, /performance Phoenix, /performance QFEX or /performance RISEx.':Performance.report(s,venue));return true;}if(text!=='/wallets')return false;reply(walletConfig.enabled?Wallet.status(s):'Wallet sync is disabled.');return true;});
    save(); // Commit command and offset together before delivery.
    if(u.callback_query?.id){try{await bot.api('answerCallbackQuery',{callback_query_id:u.callback_query.id});}catch(e){console.error('Button acknowledgement unavailable; registration result is preserved ('+Log.safe(e)+')');}}
   }
  }catch(e){
   // 409 = another getUpdates poller or a webhook uses this token; back off instead of hammering.
   const hint=e.status===409?'; another process is polling this bot token or a webhook is set':'',wait=e.retryAfter?e.retryAfter*1000:e.status===409?15000:3000;
   console.error(new Date().toISOString()+' Telegram polling unavailable; monitoring continues ('+Log.safe(e)+hint+')');await new Promise(r=>setTimeout(r,wait));}
  await flush();
 }
})().catch(e=>{console.error('Position monitor stopped; check configuration/state or webhook. No credentials displayed. ('+Log.safe(e)+')');process.exitCode=1;});

