// Offline end-to-end daemon test. Fake Telegram/market responses; never uses credentials or network.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const folder=fs.mkdtempSync(path.join(__dirname,'monitor-test-'));
process.on('exit',()=>fs.rmSync(folder,{recursive:true,force:true}));
process.env.PAIRDESK_WALLET_CONFIG=path.join(folder,'disabled.json');process.env.PAIRDESK_STATE_DIR=folder;process.env.TELEGRAM_BOT_TOKEN='123:TEST_ONLY';process.env.TELEGRAM_CHAT_ID='42';
let clock=Date.UTC(2026,9,19,12),poll=0,mode=0,registered=false,tp=false,stop=false,time=false,closed=false,positionId,failedDelivery=false,acknowledged=false;
const base=clock;Date.now=()=>clock;
const Store=require('./storage.cjs');
const id=Store.signal(folder,{ready:true,venue:'Popdex',a:{id:'A',side:'SHORT'},b:{id:'B',side:'LONG'},alpha:0,beta:1,sd:.01,z:2,tpZ:.3,stopZ:4,maxHoldMinutes:120,createdAt:base-1000,expiresAt:base+300000});
require('./monitor-feeds.cjs').quotes=async(positions)=>{
 if(!positions.length)return ()=>({});
 const z=mode===0?.2:4.2;mode++;
 return ()=>({a:{bid:100*Math.exp(z*.01),ask:100*Math.exp(z*.01),quoteTime:clock},b:{bid:100,ask:100,quoteTime:clock}});
};
const timer=setTimeout(()=>{console.error('Offline daemon test timed out');fs.rmSync(folder,{recursive:true,force:true});process.exit(1);},5000);
let updateId=1;
global.fetch=async(url,options)=>{
 await new Promise(r=>setTimeout(r,1));
 assert.ok(url.startsWith('https://api.telegram.org/bot123:TEST_ONLY/'));
 const method=url.split('/').at(-1),body=JSON.parse(options.body);let result;
 if(method==='answerCallbackQuery'){acknowledged=true;result=true;}
 else if(method==='getMe')result={username:'pairdeskbot'};
 else if(method==='getWebhookInfo')result={url:''};
 else if(method==='getUpdates'){
  clock+=60000;poll++;
  assert.ok(body.allowed_updates.includes('callback_query'));
  const input=poll===1?['102','500','100','500','0','CONFIRM']:time&&!closed?['/close '+positionId+' confirm']:[];
  const first=poll===1?[{update_id:updateId++,callback_query:{id:'callback-test',data:'open:'+id,from:{id:42},message:{date:1,chat:{id:42,type:'private'},from:{is_bot:true,username:'pairdeskbot'}}}}]:[];
  result=first.concat(input.map(text=>({update_id:updateId++,message:{text,date:clock/1000,chat:{id:42,type:'private'},from:{id:42}}})));
 }else if(method==='sendMessage'){
  const text=body.text;
  if(text.includes('registered. Monitoring starts')){registered=true;positionId=text.split(' ')[0];}
  if(text.includes('PAIRDESK — PAIR Z-TARGET')){if(!failedDelivery){failedDelivery=true;throw Error('Simulated temporary delivery failure');}tp=true;}
  if(text.includes('PAIRDESK — PAIR Z-STOP')){stop=true;clock+=121*60000;}
  if(text.includes('PAIRDESK — TIME LIMIT'))time=true;
  if(text.includes('marked closed. Monitoring stopped')){
   closed=true;if(!(registered&&tp&&stop&&time&&acknowledged)){console.error('Missing event in daemon test');process.exit(1);}
   const saved=JSON.parse(fs.readFileSync(path.join(folder,'positions.json'),'utf8'));
   assert.ok(saved.positions[positionId].closedAt);
   assert.ok(saved.offset>1);
   clearTimeout(timer);fs.rmSync(folder,{recursive:true,force:true});
   console.log('Offline daemon integration passed: saved signal -> Register trade button -> callback acknowledgement -> Telegram registration -> TP -> SL -> time -> confirmed close');
   process.exit(0);
  }
  result={message_id:1};
 }else throw Error('Unexpected fake method');
 return {ok:true,json:async()=>({ok:true,result})};
};
require('./monitor.cjs');

