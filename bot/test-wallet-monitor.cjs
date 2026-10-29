// Run the actual daemon with fake wallet, quote and Telegram adapters only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const folder=fs.mkdtempSync(path.join(__dirname,'wallet-daemon-test-'));
process.on('exit',()=>fs.rmSync(folder,{recursive:true,force:true}));
process.env.PAIRDESK_STATE_DIR=folder;process.env.PAIRDESK_WALLET_CONFIG=path.join(folder,'wallet.json');
process.env.TELEGRAM_BOT_TOKEN='123:TEST_ONLY';process.env.TELEGRAM_CHAT_ID='42';
fs.writeFileSync(process.env.PAIRDESK_WALLET_CONFIG,JSON.stringify({enabled:true}));
let clock=1792535000000,cycle=0,linked=false,updated=false,paused=false,tp=false,uid=1;
const start=clock;Date.now=()=>clock;
require('./storage.cjs').signal(folder,{ready:true,venue:'Popdex',a:{id:'AAA',side:'LONG'},b:{id:'BBB',side:'SHORT'},alpha:0,beta:1,sd:.01,tpZ:-.3,stopZ:-4,maxHoldMinutes:120,createdAt:start-60000,expiresAt:start+240000});
const rows=[{symbol:'AAA',side:'LONG',quantity:5,price:100,enteredAt:start-10000,generation:'a'},{symbol:'BBB',side:'SHORT',quantity:5,price:100,enteredAt:start-5000,generation:'b'}];
require('./wallet-feeds.cjs').fetchAccounts=async()=>{
 cycle++;return [{account:'Popdex',venue:'Popdex',ok:cycle!==4,at:clock,revision:String(cycle),rows:cycle>=5?[]:rows.map((r,i)=>({...r,quantity:cycle>=3&&i===0?2:r.quantity}))}];
};
require('./monitor-feeds.cjs').quotes=async()=>()=>({a:{bid:100,ask:100,quoteTime:clock},b:{bid:100,ask:100,quoteTime:clock}});
const timer=setTimeout(()=>{console.error('Wallet daemon test timed out');process.exit(1);},5000);
global.fetch=async(url,options)=>{
 assert.ok(url.startsWith('https://api.telegram.org/bot123:TEST_ONLY/'));
 const method=url.split('/').at(-1),body=JSON.parse(options.body);let result;
 if(method==='getMe')result={username:'pairdeskbot'};
 else if(method==='getWebhookInfo')result={url:''};
 else if(method==='getUpdates'){clock+=60000;result=[{update_id:uid++,message:{text:'/wallets',date:clock/1000,chat:{type:'private',id:42},from:{id:42}}}];}
 else if(method==='sendMessage'){
  const text=body.text;
  if(text.includes('WALLET TRACKING ACTIVE'))linked=true;
  if(text.includes('POSITION SIZE UPDATED'))updated=true;
  if(text.includes('WALLET SYNC UNAVAILABLE'))paused=true;
  if(text.includes('PAIRDESK — PAIR Z-TARGET'))tp=true;
  if(text.includes('EXCHANGE CLOSURE DETECTED')){
   assert.ok(linked&&updated&&paused&&tp);
   const s=JSON.parse(fs.readFileSync(path.join(folder,'positions.json'),'utf8')),p=Object.values(s.positions)[0];
   assert.equal(Object.keys(s.positions).length,1);assert.ok(p.closedAt);assert.equal(p.notionalA,200);assert.equal(p.deadline,start-10000+120*60000);
   clearTimeout(timer);console.log('Wallet daemon integration passed: automatic import, saved state, TP, partial exit, API outage and two-check closure.');process.exit(0);
  }result={message_id:uid};
 }else throw Error('Unexpected mock request');
 return {ok:true,json:async()=>({ok:true,result})};
};
require('./monitor.cjs');
