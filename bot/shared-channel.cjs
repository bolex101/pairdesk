const fs=require('node:fs'),path=require('node:path'),Telegram=require('./telegram.cjs');
function target(value){
 const text=String(value||'').trim(),match=/^https:\/\/t\.me\/c\/(\d+)\/\d+(?:\?.*)?$/.exec(text);
 const id=match?'-100'+match[1]:text;
 if(!/^-100[1-9]\d{5,}$/.test(id)&&!/^@[A-Za-z][A-Za-z0-9_]{4,}$/.test(id))throw Error('Use a channel post link, numeric channel ID or public @username—not an invite link.');
 return id;
}
function checkChat(chat){
 if(chat?.type!=='channel'||!/^\-100[1-9]\d{5,}$/.test(String(chat.id)))throw Error('Destination must be a Telegram channel.');
 return String(chat.id);
}
function message(a){
 const p=a.pair,q=a.plan,n=(v,d=2)=>Number.isFinite(v)?v.toFixed(d):'unavailable';
 if(!q?.ready||!['Popdex','Arcus','Variational','Ondo','Phoenix','QFEX','RISEx'].includes(a.venue)||![q.a,q.b].every(l=>/^[A-Za-z0-9_.-]{1,40}$/.test(l?.id)&&['LONG','SHORT'].includes(l.side)))throw Error('Invalid public research signal');
 // Explicit public-field allowlist: never serialize account state, user text or full plans.
 return [
 'PAIRDESK — SHARED RESEARCH SETUP',a.venue+' · '+q.a.id+' / '+q.b.id,'',
 '• Direction: '+q.a.side+' '+q.a.id+' / '+q.b.side+' '+q.b.id,
 '• Score: '+n(p.score,0)+'/100 (not a win probability)',
 '• Signal z: '+n(p.z)+'; 15m z: '+n(p.confirm),
 '• Correlation: '+n(p.corr)+'; estimated half-life: '+n(p.half)+' min',
 '• Full-reversion move / estimated round-trip friction: '+n(p.edge)+' / '+n(p.cost)+' bps',
 '• Hedge beta: '+n(q.beta,8)+' (B notional / A notional)',
 '• Indicative entry references: '+q.a.id+' ~'+n(q.a.entry,6)+'; '+q.b.id+' ~'+n(q.b.entry,6),
 '• Live midpoint z: '+n(q.z)+'; entry window expires '+new Date(q.expiresAt).toISOString(),
 '• Entry only while same-direction |fixed z| is 1.5–3; recheck current quotes and costs.',
 '• PAIR Z-TARGET: z '+(q.tpOperator==='≤'?'≤':'≥')+' '+n(q.tpZ)+'; exit both legs',
 '• PAIR Z-STOP: z '+(q.stopOperator==='≤'?'≤':'≥')+' '+n(q.stopZ)+'; exit both legs',
 '• Time exit: '+n(q.maxHoldMinutes,0)+' minutes from actual entry.',
 '• Z targets describe the pair relationship, not guaranteed monetary profit or loss.',
 '• Data: '+(a.venue==='Ondo'?'Locally sampled order-book midpoints':a.venue==='Variational'?'Locally sampled mark prices; indicative quotes':a.venue==='Arcus'?'Oracle candles and public quotes':'Exchange candles and public quotes'),
 '• Research only. Prices are indicative; funding and market impact excluded. Review before trading.',
 '• Channel posts do not monitor positions. Approved friends can register privately with the bot for notifications. No orders or stops are placed.'
 ].join('\n');
}
function config(file=path.join(__dirname,'channel-config.json')){
 if(!fs.existsSync(file))return {enabled:false};
 const c=JSON.parse(fs.readFileSync(file,'utf8'));
 if(c.enabled!==true)return {enabled:false};
 if(!/^-100[1-9]\d{5,}$/.test(String(c.chatId)))throw Error('Invalid shared-channel configuration');
 return c;
}
async function send(a,c,api,signalId){
 if(!c.enabled)return false;
 const text=message(a);
 const chat=await api('getChat',{chat_id:c.chatId});
 if(checkChat(chat)!==String(c.chatId))throw Error('Channel identity changed');
 if(text.length>4000)throw Error('Shared alert too long');
 await api('sendMessage',{chat_id:c.chatId,text,...(/^[a-f0-9]{12}$/.test(signalId||'')?{reply_markup:{inline_keyboard:[[{text:'Register my trade — private',url:'https://t.me/pairdeskbot?start=trade_'+signalId}]]}}:{})});
 return true;
}
async function deliver(a,signalId,dir){
 const c=config();if(!c.enabled)return false;
 const delivered=await send(a,c,Telegram.client(process.env.TELEGRAM_BOT_TOKEN,process.env.TELEGRAM_CHAT_ID).api,signalId);
 if(delivered&&/^[a-f0-9]{12}$/.test(signalId||'')&&dir){
  const folder=path.join(dir,'shared-signals');fs.mkdirSync(folder,{recursive:true,mode:0o700});
  require('./storage.cjs').save(path.join(folder,signalId+'.json'),{publishedAt:Date.now(),channelId:c.chatId});
 }
 return delivered;
}
module.exports={target,checkChat,message,config,send,deliver};
