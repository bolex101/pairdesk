const fs=require('node:fs'),path=require('node:path'),S=require('./shared-channel.cjs'),T=require('./telegram.cjs');
(async()=>{
 const bot=T.client(process.env.TELEGRAM_BOT_TOKEN,process.env.TELEGRAM_CHAT_ID);
 const dest=S.target(process.argv[2]),chat=await bot.api('getChat',{chat_id:dest}),id=S.checkChat(chat);
 const me=await bot.api('getMe'),member=await bot.api('getChatMember',{chat_id:id,user_id:me.id});
 if(member.status!=='creator'&&!(member.status==='administrator'&&member.can_post_messages===true))throw Error('Make @pairdeskbot a channel admin with Post messages enabled.');
 console.log('Verified channel: '+chat.title+' ('+id+')');
 const result=await bot.api('sendMessage',{chat_id:id,text:'PAIRDESK — CHANNEL TEST\nShared research alerts are connected.\nThis channel receives research setups only. Wallet positions, balances, fills and monitoring notifications remain private.\nTEST ONLY — no trade or action required.'});
 if(String(result?.chat?.id)!==id||result.chat.type!=='channel')throw Error('Channel test delivery could not be verified');
 const file=path.join(__dirname,'channel-config.json'),temp=file+'.tmp';
 fs.writeFileSync(temp,JSON.stringify({enabled:true,chatId:id})+'\n',{mode:0o644});fs.chmodSync(temp,0o644);fs.renameSync(temp,file);
 console.log('Shared channel enabled. Future qualifying signals will be posted. No old signals replayed.');
})().catch(()=>{console.error('Channel setup failed. Check the post link and bot admin/Post messages permission. Credentials hidden; channel configuration was not enabled by this attempt.');process.exitCode=1;});
