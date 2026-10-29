const crypto=require('node:crypto'),W=require('./wallet-sync.cjs');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,16);
const key=r=>r.symbol+':'+r.side;
const identity=(account,rows)=>hash([account,...rows.map(r=>[key(r),r.generation]).sort((a,b)=>a[0].localeCompare(b[0]))]);
function candidates(s,plan,account,now){
 return Object.values(s.wallets?.accounts||{}).filter(x=>x.venue===plan.venue&&(!account||x.account===account)&&x.ok&&x.stable&&now-x.at<=120000&&x.at<=now+5000).flatMap(x=>{
  const rows=[plan.a,plan.b].map(l=>x.rows.filter(r=>r.symbol===l.id&&r.side===l.side));
  if(rows.some(list=>list.length!==1))return [];
  const legs=rows.map(list=>list[0]);
  if(legs.some(r=>!r.generation||!Number.isFinite(r.enteredAt)||r.enteredAt<plan.createdAt-60000||r.enteredAt>now+5000||![r.quantity,r.price].every(n=>Number.isFinite(n)&&n>0)||!Number.isFinite(r.quantity*r.price)))return [];
  return [{account:x.account,rows:legs,identity:identity(x.account,legs),fingerprint:hash([x.account,legs])}];
 });
}
function conflict(s,signalId,plan,c){
 const active=Object.values(s.positions).filter(p=>!p.closedAt);
 const same=active.filter(p=>p.signalId===signalId);
 if(same.length>1)return 'Several registrations use this signal. Resolve those registrations first.';
 if(same[0]?.wallet)return 'This signal already has wallet tracking. Use /positions.';
 if(active.some(p=>p.id!==same[0]?.id&&p.plan.venue===plan.venue&&(!p.wallet||p.wallet.account===c.account)&&[p.plan.a,p.plan.b].some(l=>c.rows.some(r=>r.symbol===l.id&&r.side===l.side))))return 'A tracked pair already uses one of these legs. Use /positions to resolve that overlap; do not close an exchange trade just to clear this message.';
 if(Object.values(s.positions).some(p=>p.closedAt&&p.wallet?.identity===c.identity))return 'This exact wallet exposure was previously marked closed. It cannot be silently reopened.';
 if(!same.length&&active.length>=10)return 'Limit of 10 monitored pairs reached.';
 return null;
}
function command(s,text,reply,loadPlan,enabled,now=Date.now()){
 if(s.walletLinkDraft&&now>s.walletLinkDraft.expiresAt)s.walletLinkDraft=null;
 if(text==='/cancel'){s.walletLinkDraft=null;return false;}
 if(text.startsWith('/open')&&s.walletLinkDraft){reply('Finish the wallet link or send /cancel before manual registration.');return true;}
 if(!/^\/link(?:\s|$)|^\/linkconfirm(?:\s|$)/.test(text))return false;
 if(!enabled){reply('Wallet sync is disabled.');return true;}
 if(s.draft){reply('Finish your manual registration or send /cancel before linking a wallet position.');return true;}
 const args=text.split(/\s+/);
 if(args[0]==='/linkconfirm'){
  const d=s.walletLinkDraft;
  if(!d||args.length!==2||args[1]!==d.nonce){reply('Link confirmation expired or already used. Send /link SIGNAL_ID again.');return true;}
  const found=candidates(s,d.plan,d.account,now).find(c=>c.fingerprint===d.fingerprint);
  if(!found){s.walletLinkDraft=null;reply('Wallet data changed or became unavailable. Nothing was linked. Send /link '+d.signalId+' again to review fresh fills.');return true;}
  const problem=conflict(s,d.signalId,d.plan,found);if(problem){s.walletLinkDraft=null;reply(problem);return true;}
  const existing=Object.values(s.positions).find(p=>!p.closedAt&&p.signalId===d.signalId);
  const enteredAt=Math.min(...found.rows.map(r=>r.enteredAt)),id=existing?.id||'w'+found.identity;
  const p=existing||{id,signalId:d.signalId,plan:d.plan,enteredAt,deadline:enteredAt+d.plan.maxHoldMinutes*60000,registeredAt:now,notified:{},last:null,staleSince:null};
  p.wallet={account:found.account,identity:found.identity,legs:found.rows.map(r=>({symbol:r.symbol,side:r.side,generation:r.generation}))};
  p.priceA=found.rows[0].price;p.priceB=found.rows[1].price;p.notionalA=found.rows[0].quantity*p.priceA;p.notionalB=found.rows[1].quantity*p.priceB;
  p.walletSuspended=false;p.walletMissing=null;p.last=null;
  s.positions[id]=p;s.walletLinkDraft=null;
  reply('WALLET TRACKING ACTIVE\n'+id+': '+found.account+' '+p.plan.a.id+' / '+p.plan.b.id+'\nActual fills linked to your chosen signal. Original z targets retained; future sizes and closures sync automatically.\nTime limit: '+new Date(p.deadline).toISOString()+' (UTC).\nNo orders placed. /positions shows this trade.');return true;
 }
 if(args.length<2||args.length>3||!/^[a-f0-9]{12}$/.test(args[1])){reply('Use /link SIGNAL_ID from the original alert. Optional account: /link SIGNAL_ID Arcus:0');return true;}
 const signalId=args[1],plan=loadPlan(signalId);
 if(!W.valid(plan)){reply('A valid saved Arcus, Popdex, Phoenix or Ondo signal is required. Variational wallet linking is unavailable.');return true;}
 const found=candidates(s,plan,args[2],now);
 if(found.length!==1){reply(found.length?'Matching legs exist in several accounts. Choose one: '+found.map(c=>'/link '+signalId+' '+c.account).join('\n'):'No stable, fresh wallet match with verified opening times was found. Both legs must match the signal direction and must not predate the signal. Wait for wallet sync, then retry /link '+signalId+'.');return true;}
 const c=found[0],problem=conflict(s,signalId,plan,c);if(problem){reply(problem);return true;}
 const nonce=crypto.randomBytes(6).toString('hex');
 s.walletLinkDraft={signalId,plan:JSON.parse(JSON.stringify(plan)),account:c.account,fingerprint:c.fingerprint,nonce,expiresAt:now+120000};
 const existing=Object.values(s.positions).find(p=>!p.closedAt&&p.signalId===signalId);
 const deadline=existing?.deadline??Math.min(...c.rows.map(r=>r.enteredAt))+plan.maxHoldMinutes*60000;
 const late=c.rows.some(r=>r.enteredAt>plan.expiresAt);
 reply(['REVIEW WALLET LINK — '+c.account,'Signal: '+signalId,...c.rows.map(r=>'• '+r.side+' '+r.symbol+': '+r.quantity+' units @ '+r.price+'; entry value '+(r.quantity*r.price).toFixed(2)),
  '• Original z target: '+plan.tpZ+'; z-stop: '+plan.stopZ,
  '• Deadline: '+new Date(deadline).toISOString()+' (UTC). '+(existing?'Existing deadline retained.':'Starts at the earlier leg opening, not now.'),
  late?'• LATE ENTRY: outside the original validity window. You are explicitly choosing this saved model for an existing trade.':'',
  deadline<=now?'• Time limit already passed; a time notification may follow immediately.':'',
  'No orders placed. Confirm within two minutes, or /cancel.'].filter(Boolean).join('\n'),{inline_keyboard:[[{text:'Confirm wallet link',callback_data:'linkconfirm:'+nonce}]]});return true;
}
module.exports={command,candidates,conflict};
