const fs=require('node:fs'),path=require('node:path'),N=require('./new-venues.cjs'),S=require('./scan-engine.js'),D=require('./data.cjs'),Store=require('./storage.cjs');
async function collect(){
 const dir=process.env.PAIRDESK_STATE_DIR||path.join(__dirname,'state');fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const file=path.join(dir,'ondo-history.json');const old=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{markets:{}};
 if(!old.markets||typeof old.markets!=='object'||Array.isArray(old.markets))throw Error('Invalid Ondo history; refusing reset');
 // Collect the whole supported universe so volume ranking changes do not reset warm-up.
 const rows=await N.enrich('Ondo',S.universe(await N.markets('Ondo'),100).rows),now=Date.now();
 const usable=rows.filter(r=>[r.price,r.quoteTime,r.bid,r.ask].every(Number.isFinite)&&r.price>0&&r.bid>0&&r.ask>=r.bid&&now-r.quoteTime<=120000&&r.quoteTime<=now+5000);
 if(!usable.length)throw Error('No fresh Ondo quotes; history preserved');
 Store.save(file,D.record(old,usable,now));
 console.log('Ondo: recorded '+usable.length+'/'+rows.length+' supported markets at '+new Date(now).toISOString()+'; sampled midpoint history; missing samples are not filled.');
}
if(require.main===module)collect().catch(()=>{console.error('Ondo collection failed; existing history preserved. Check public API connectivity and collector permissions.');process.exitCode=1;});
module.exports={collect};
