const Identity=require('./identity.cjs');
const Buttons=require('./buttons.cjs'),Risk=require('./risk.cjs');
const HELP=['Pairdesk position monitoring','/open SIGNAL_ID — register actual fills from a NEW setup alert','/positions — open trades and last observations','/status — monitor health','/wallets — wallet sync health','/link SIGNAL_ID — review and link existing wallet fills','/performance — simulated results by score, before funding','/close POSITION_ID — mark both legs closed AFTER closing them on the exchange','/cancel — cancel registration','/test — labelled TP, stop and time-limit tests','/testbutton — try Register trade without creating a position','Notifications only. No orders placed. Periodic quotes can miss brief crossings.'].join('\n');
function initial(){return {version:1,offset:0,positions:{},draft:null,outbox:[]};}
function queue(s,id,text,replyMarkup){const chunks=text.match(/[\s\S]{1,3400}/g)||[''];for(let i=0;i<chunks.length;i++){const key=chunks.length===1?id:id+'-part'+i;if(!s.outbox.some(x=>x.id===key))s.outbox.push({id:key,text:chunks[i],...(i===chunks.length-1&&replyMarkup?{replyMarkup}:{})});}}
function positive(t){if(!/^\d+(\.\d+)?$/.test(t))return null;const n=Number(t);return Number.isFinite(n)&&n>0&&n<=1e9?n:null;}
function date(t){return new Date(t).toLocaleString('en-GB',{timeZone:'Africa/Lagos',hour12:false})+' Lagos';}
function summary(p){const l=p.last;return [p.id+': '+p.plan.venue+' '+p.plan.a.id+'/'+p.plan.b.id,p.plan.a.side+' '+p.notionalA.toFixed(2)+' @ '+p.priceA+'; '+p.plan.b.side+' '+p.notionalB.toFixed(2)+' @ '+p.priceB,'Time limit '+date(p.deadline),l&&!p.staleSince&&!p.walletSuspended?'Last z '+l.z.toFixed(2)+'; close-value P&L '+l.pnl.toFixed(2)+' before fees/funding, observed '+date(l.at):p.walletSuspended?'Wallet verification unavailable; TP/stop checks paused':'Fresh price check pending or unavailable'].join('\n');}
const fields=['priceA','notionalA','priceB','notionalB'];
function prompt(d){const p=d.plan;return ['Actual average fill price for '+p.a.side+' '+p.a.id+'? Send a positive number.','Actual '+p.a.id+' position value at entry, in quote currency (not margin or contract count)?','Actual average fill price for '+p.b.side+' '+p.b.id+'?','Actual '+p.b.id+' position value at entry, in quote currency (not margin)?','How many minutes ago did BOTH legs finish filling? Send 0 if just now, or a number up to 10080.'][d.step];}
function handle(s,u,chatId,loadPlan,now=Date.now(),extraCommand){
 if(!Number.isSafeInteger(u.update_id)||u.update_id<s.offset)return;
 s.offset=u.update_id+1;
 const m=u.callback_query?Buttons.callbackMessage(u.callback_query,chatId,now):u.message;
 if(!m||m.chat?.type!=='private'||String(m.chat.id)!==String(chatId)||String(m.from?.id)!==String(chatId)||m.from?.is_bot||typeof m.text!=='string')return;
 const reply=(t,markup)=>queue(s,'command-'+u.update_id,t,markup);
 if(!Number.isFinite(m.date)||now-m.date*1000>600000||m.date*1000>now+60000){reply('That command is too old to apply. Send it again.');return;}
 const text=m.text.trim().replace(new RegExp('^/(\\w+)@'+Identity.username()+'\\b','i'),'/$1');
 if(s.draft&&now-s.draft.startedAt>1800000)s.draft=null;
 if(extraCommand&&extraCommand(text,reply))return;
 if(text==='/help'||text==='/start'){reply(HELP);return;}
 if(text==='/cancel'){s.draft=null;reply('Registration cancelled. Existing positions are unchanged.');return;}
 if(text==='/positions'){const open=Object.values(s.positions).filter(p=>!p.closedAt);reply(open.length?open.map(summary).join('\n\n'):'No registered open positions. Use /open with the ID in a new setup alert.');return;}
 if(text==='/status'){reply('Monitor is responding. Open trades: '+Object.values(s.positions).filter(p=>!p.closedAt).length+'. Last cycle: '+(s.lastCycle?date(s.lastCycle):'not yet completed')+'. Pending notifications: '+s.outbox.length+'.\nChecks run approximately every 30–60 seconds when APIs respond. No orders placed.');return;}
 if(text==='/testbutton'){reply('TEST ONLY: tap Register trade below to check the button. This will not register a position.',Buttons.testKeyboard());return;}
 if(text==='/testbutton_clicked'){reply('TEST PASSED: the Register trade button works. No trade was registered. Real alert buttons begin the fill-entry questions.');return;}
 if(text==='/test'){testEvents(s,'test-'+u.update_id,now);return;}
 if(text.startsWith('/close')){
  const args=text.split(/\s+/),p=Object.hasOwn(s.positions,args[1])?s.positions[args[1]]:null;
  if(!p){reply('Unknown position ID. Use /positions.');return;}
  if(p.closedAt){reply('Already marked closed.');return;}
  if(args.length!==3||args[2]!=='confirm'){reply('After BOTH legs are closed on the exchange, send:\n/close '+p.id+' confirm\nThis only stops monitoring. It does not close exchange positions.');return;}
  p.closedAt=now;s.outbox=s.outbox.filter(e=>!e.id.startsWith(p.id+':'));
  reply(p.id+' marked closed. Monitoring stopped. No exchange action was taken.');return;
 }
 if(text.startsWith('/open')){
  const args=text.split(/\s+/),id=args[1];
  if(args.length!==2||!/^[a-f0-9]{12}$/.test(id||'')){reply('Use /open SIGNAL_ID from a new setup alert. Older alerts without IDs cannot be reconstructed.');return;}
  if(Object.values(s.positions).some(p=>!p.closedAt&&p.signalId===id)){reply('That signal already has an open trade. Use /positions.');return;}
  if(Object.values(s.positions).filter(p=>!p.closedAt).length>=10){reply('Limit: 10 open trades. Mark finished trades closed first.');return;}
  if(s.draft){reply(s.draft.signalId===id?'Registration is already in progress. Continue with the last question, or /cancel to restart.':'Finish the current registration or send /cancel before choosing another trade.');return;}
  const p=loadPlan(id);
  if(!p||!p.ready||!['Popdex','Arcus','Variational','Ondo','Phoenix','QFEX','RISEx'].includes(p.venue)||![p.beta,p.alpha,p.sd,p.tpZ,p.stopZ,p.maxHoldMinutes,p.createdAt].every(Number.isFinite)||p.beta<=0||p.sd<=0){reply('Saved signal missing or invalid. Use a new alert after this upgrade.');return;}
  s.draft={signalId:id,plan:JSON.parse(JSON.stringify(p)),step:0,startedAt:now,values:{}};
  reply('Register an ALREADY OPEN trade: '+p.venue+', '+p.a.side+' '+p.a.id+' / '+p.b.side+' '+p.b.id+'.\nNo orders placed. /cancel stops registration.\n'+prompt(s.draft));return;
 }
 const d=s.draft;
 if(!d){reply(HELP);return;}
 if(d.step<4){const n=positive(text);if(n===null){reply('Send a positive number without commas, currency symbols or units. /cancel to stop.');return;}d.values[fields[d.step]]=n;d.step++;reply(prompt(d));return;}
 if(d.step===4){
  if(!/^\d+(\.\d+)?$/.test(text)||!Number.isFinite(Number(text))||Number(text)>10080){reply('Send minutes ago from 0 to 10080.');return;}
  const enteredAt=now-Number(text)*60000;
  if(enteredAt<d.plan.createdAt-60000){reply('That entry predates this signal. Use the signal you actually traded; /cancel to stop.');return;}
  d.values.enteredAt=enteredAt;d.step=5;
  const v=d.values,ratio=v.notionalB/v.notionalA;
  reply(['CONFIRM registration for '+d.plan.venue,d.plan.a.side+' '+d.plan.a.id+': '+v.notionalA+' @ '+v.priceA,d.plan.b.side+' '+d.plan.b.id+': '+v.notionalB+' @ '+v.priceB,'Entry '+date(enteredAt),'Fixed TP z '+d.plan.tpZ+', stop z '+d.plan.stopZ+'; time exit '+date(enteredAt+d.plan.maxHoldMinutes*60000)+'.',Math.abs(ratio/d.plan.beta-1)>.1?'Actual allocation differs from the suggested hedge by over 10%; thresholds may not match profitable P&L.':'',enteredAt>d.plan.expiresAt?'Entry was after the signal validity window. This records your existing trade, not a new entry recommendation.':'','Send CONFIRM to start monitoring, or /cancel. No orders will be placed.'].filter(Boolean).join('\n'));return;
 }
 if(text.toUpperCase()!=='CONFIRM'){reply('Send CONFIRM, or /cancel to enter the fills again.');return;}
 const id='p'+u.update_id.toString(36);
 s.positions[id]={id,signalId:d.signalId,plan:d.plan,...d.values,deadline:d.values.enteredAt+d.plan.maxHoldMinutes*60000,registeredAt:now,notified:{},last:null,staleSince:null};
 s.draft=null;
 reply(id+' registered. Monitoring starts next cycle.\n'+summary(s.positions[id])+'\nNotifications only; close both legs yourself. Use /close '+id+' after closing them.');
}
function readQuotes(p,quotes,now){
 const a=quotes?.a,b=quotes?.b;
 for(const q of [a,b])if(!q||![q.bid,q.ask,q.quoteTime].every(Number.isFinite)||q.bid<=0||q.ask<q.bid||now-q.quoteTime>120000||q.quoteTime>now+5000)return null;
 if(Math.abs(a.quoteTime-b.quoteTime)>60000)return null;
 const z=(Math.log((a.bid+a.ask)/2)-p.plan.alpha-p.plan.beta*Math.log((b.bid+b.ask)/2))/p.plan.sd;
 const exitA=p.plan.a.side==='LONG'?a.bid:a.ask,exitB=p.plan.b.side==='LONG'?b.bid:b.ask;
 const pnl=(p.plan.a.side==='LONG'?1:-1)*(p.notionalA/p.priceA)*(exitA-p.priceA)+(p.plan.b.side==='LONG'?1:-1)*(p.notionalB/p.priceB)*(exitB-p.priceB);
 if(!Number.isFinite(z)||!Number.isFinite(pnl))return null;
 return {z,pnl,at:now,quoteA:a.quoteTime,quoteB:b.quoteTime};
}
function evaluate(s,p,quotes,now=Date.now(),checkPrices=true){
 if(p.closedAt)return;
 const notify=(kind,extra)=>{
  if(p.notified[kind])return;p.notified[kind]=now;
  const label=kind==='STOP LOSS'?'PAIR Z-STOP':kind==='TAKE PROFIT'?'PAIR Z-TARGET':kind;
  queue(s,p.id+':'+label,[(p.test?'PAIRDESK TEST — ':'PAIRDESK — ')+label,p.id+': '+p.plan.venue+' '+p.plan.a.id+' / '+p.plan.b.id,extra,p.test?'TEST ONLY. No real trade or action required.':'Review and close BOTH legs manually. I have not closed anything. Afterward: /close '+p.id].join('\n'));
 };
 if(now>=p.deadline)notify('TIME LIMIT','The '+p.plan.maxHoldMinutes+'-minute limit expired at '+date(p.deadline)+'. Time checks work even when quotes are stale.');
 if(!checkPrices||p.walletSuspended)return;
 const last=readQuotes(p,quotes,now);
 if(!last){
  if(!p.staleSince)p.staleSince=now;
  if(!p.staleWarningAt||now-p.staleWarningAt>=3600000){
   p.staleWarningAt=now;p.recoveryPending=true;
   queue(s,p.id+':stale:'+now,'PRICE MONITORING UNAVAILABLE\n'+p.id+': '+p.plan.venue+' '+p.plan.a.id+'/'+p.plan.b.id+'\nFresh aligned bid/ask quotes unavailable. TP/stop crossings cannot be checked reliably. Time-limit checks continue. Check the exchange directly.');
  }return;
 }
 p.last=last;
 if(p.staleSince&&p.recoveryPending){queue(s,p.id+':recovered:'+now,'Price monitoring resumed for '+p.id+'. Crossings during the data gap may have been missed.');p.recoveryPending=false;}
 p.staleSince=null;
 Risk.check(s,p,quotes,now,queue);
 const shortA=p.plan.a.side==='SHORT',rounded=Number(last.pnl.toFixed(2));
 const outcome=rounded>0?'PROFIT':rounded<0?'LOSS':'APPROX. BREAK-EVEN';
 const amount=(rounded>0?'+':'')+rounded.toFixed(2);
 const currency=p.plan.venue==='Popdex'?'USDT':p.plan.venue==='TEST'?'test units':'USD-equivalent';
 const detail=['• Fixed-fit z: '+last.z.toFixed(3),
  '• Estimated position P&L: '+outcome+' ('+amount+' '+currency+')',
  '• BEFORE fees and funding; indicative close value, not realized P&L.',
  '• Trigger: saved pair z threshold, not a monetary profit/loss threshold.',
  p.wallet?'• Remaining open size only; realized partial exits excluded.':'• Based on registered entry prices and sizes.',
  '• Public quotes are indicative, not guaranteed fills.'].join('\n');
 if(shortA?last.z>=p.plan.stopZ:last.z<=p.plan.stopZ)notify('STOP LOSS',detail);
 else if(shortA?last.z<=p.plan.tpZ:last.z>=p.plan.tpZ)notify('TAKE PROFIT',detail);
}
function testEvents(s,id,now){
 const p={id,test:true,plan:{venue:'TEST',a:{id:'TEST-A',side:'SHORT'},b:{id:'TEST-B',side:'LONG'},alpha:0,beta:1,sd:.01,tpZ:.3,stopZ:4,maxHoldMinutes:120},priceA:100*Math.exp(.02),priceB:100,notionalA:500,notionalB:500,deadline:now+1,notified:{}};
 const q=z=>({a:{bid:100*Math.exp(z*.01),ask:100*Math.exp(z*.01),quoteTime:now},b:{bid:100,ask:100,quoteTime:now}});
 evaluate(s,p,q(.2),now);evaluate(s,p,q(4.1),now);evaluate(s,p,null,now+2,false);
}
module.exports={queue,initial,handle,readQuotes,evaluate,testEvents,summary,HELP};

