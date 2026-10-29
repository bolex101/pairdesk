// Repo-level check: skipped when only bot/ is present (e.g. a server copy).
if(!require('node:fs').existsSync(require('node:path').join(__dirname,'..','scripts'))){console.log('Skipped: scripts/ not present');process.exit(0);}
const A=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),{spawnSync}=require('node:child_process');
// Bot username is configurable for a separate test bot; production default unchanged.
delete process.env.PAIRDESK_BOT_USERNAME;const I=require('./identity.cjs');A.equal(I.username(),'pairdeskbot');
process.env.PAIRDESK_BOT_USERNAME='@Pairdesk_Test_Bot';A.equal(I.username(),'pairdesk_test_bot');
const B=require('./buttons.cjs'),id='abcdef123456';
const cb=u=>({data:'open:'+id,from:{id:42},message:{chat:{type:'private',id:42},from:{is_bot:true,username:u}}});
A.notEqual(B.callbackMessage(cb('pairdesk_test_bot'),'42',Date.now()),null);A.equal(B.callbackMessage(cb('pairdeskbot'),'42',Date.now()),null,'production bot buttons ignored in test mode');
process.env.PAIRDESK_BOT_USERNAME='bad name!';A.throws(()=>I.username());process.env.PAIRDESK_BOT_USERNAME='pairdesk_test_bot';
// Channel config path is configurable; absent file means the shared channel is disabled.
const S=require('./shared-channel.cjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdtest-'));
process.env.PAIRDESK_CHANNEL_CONFIG=path.join(dir,'channel-config.json');A.deepEqual(S.config(),{enabled:false});
fs.writeFileSync(process.env.PAIRDESK_CHANNEL_CONFIG,JSON.stringify({enabled:true,chatId:'-1001234567'}));A.equal(S.config().chatId,'-1001234567');
delete process.env.PAIRDESK_CHANNEL_CONFIG;
// The test-run wrapper refuses unsafe setups before doing anything.
const script=path.join(__dirname,'..','scripts','test-run.sh');
const run=(args,env)=>spawnSync('bash',[script,...args],{env:{PATH:process.env.PATH,HOME:dir,NODE:process.execPath,...env},encoding:'utf8'});
let r=run([],{});A.equal(r.status,2);
r=run(['scan'],{PAIRDESK_TEST_STATE_DIR:'/var/lib/pairdesk'});A.equal(r.status,1);A.match(r.stdout,/production state/);
r=run(['scan'],{PAIRDESK_TEST_STATE_DIR:dir});A.notEqual(r.status,0);A.match(r.stderr,/PAIRDESK_TEST_TELEGRAM_BOT_TOKEN/);
const t={PAIRDESK_TEST_STATE_DIR:dir,PAIRDESK_TEST_TELEGRAM_BOT_TOKEN:'1:x',PAIRDESK_TEST_TELEGRAM_CHAT_ID:'1'};
r=run(['scan'],{...t,PAIRDESK_TEST_BOT_USERNAME:'PairdeskBot'});A.equal(r.status,1);A.match(r.stdout,/production bot/);
r=run(['scan'],{...t,PAIRDESK_TEST_BOT_USERNAME:'pd_test_bot',TELEGRAM_BOT_TOKEN:'1:x'});A.equal(r.status,1);A.match(r.stdout,/equals TELEGRAM_BOT_TOKEN/);
fs.rmSync(dir,{recursive:true});
console.log('Test-mode checks passed: configurable bot username and channel file, wrapper refuses production state/bot/token');
