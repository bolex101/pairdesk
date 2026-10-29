const A=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),F=require('./friends.cjs'),C=require('./positions.cjs'),Feeds=require('./monitor-feeds.cjs'),O=require('./ondo-wallet.cjs'),S=require('./shared-channel.cjs');
(async()=>{
 const dir=fs.mkdtempSync(path.join(__dirname,'friend-worker-test-'));
 try{
  process.env.CREDENTIALS_DIRECTORY=dir;
  fs.writeFileSync(path.join(dir,'ondo-friend-100'),JSON.stringify({keyId:'friend100',secretKey:'test100'}));
  fs.writeFileSync(path.join(dir,'ondo-friend-200'),JSON.stringify({keyId:'friend200',secretKey:'test200'}));
  O.fetchAccount=async(address,key)=>{A.equal(address,'0x'+'b'.repeat(40));A.equal(key.keyId,'friend100');return {venue:'Ondo',ok:true,rows:[]};};
  A.equal((await F.snapshots({wallets:{Ondo:{enabled:true,address:'0x'+'b'.repeat(40)}}},'100'))[0].ok,true);
  A.equal((await F.snapshots({wallets:{Ondo:{enabled:true,address:'0x'+'b'.repeat(40)}}},'300'))[0].ok,false);
  const s=C.initial(),m=F.members(s)['100']={status:'approved',epoch:1,wallets:{},state:C.initial()};
  const now=Date.now();m.state.positions.p={id:'p',plan:{venue:'Popdex',a:{id:'AAA',side:'SHORT'},b:{id:'BBB',side:'LONG'},alpha:0,beta:1,sd:.01,tpZ:.3,stopZ:4,maxHoldMinutes:120},deadline:now+3600000,priceA:101,priceB:100,notionalA:500,notionalB:500,notified:{}};
  let release,started=false,sends=[];
  Feeds.quotes=async()=>{started=true;return new Promise(r=>release=r);};
  const pump=F.runner(s,()=>{}, {api:async(method,data)=>sends.push(data)},dir);
  pump();
  for(let i=0;i<20&&!started;i++)await new Promise(r=>setTimeout(r,1));
  A.ok(started);
  F.admin(s,'/revoke 100',()=>{});
  release(()=>({a:{bid:100,ask:100,quoteTime:Date.now()},b:{bid:100,ask:100,quoteTime:Date.now()}}));
  await new Promise(r=>setTimeout(r,5));
  A.equal(m.state.positions.p.last,undefined);A.deepEqual(m.state.positions.p.notified,{});
  pump();await new Promise(r=>setTimeout(r,5));A.ok(sends.length);A.ok(sends.every(x=>x.chat_id==='100'&&!x.text.includes('PAIR Z-TARGET')));
  const a={venue:'Phoenix',pair:{score:75,z:2,confirm:1,corr:.8,half:60,edge:30,cost:10},plan:{ready:true,a:{id:'AAA',side:'SHORT',entry:100},b:{id:'BBB',side:'LONG',entry:50},beta:1,z:2,expiresAt:now+300000,tpZ:.3,stopZ:4,tpOperator:'≤',stopOperator:'≥',maxHoldMinutes:120}};
  let sent;
  await S.send(a,{enabled:true,chatId:'-1001234567890'},async(method,data)=>{if(method==='getChat')return {id:-1001234567890,type:'channel'};sent=data;},'abcdef123456');
  const button=sent.reply_markup.inline_keyboard[0][0];A.equal(button.url,'https://t.me/pairdeskbot?start=trade_abcdef123456');A.equal(button.callback_data,undefined);
  console.log('Friend worker tests passed: per-friend credential routing, missing credentials fail closed, in-flight revocation blocks updates, private notification routing and channel deep-link button.');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
