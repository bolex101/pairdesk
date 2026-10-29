const fs=require('node:fs'),path=require('node:path'),D=require('./data.cjs'),Fetch=require('./collector-fetch.cjs');
function diskError(stage,e){return Fetch.failure(stage+' failed'+(['EACCES','EPERM','ENOSPC','EROFS','ENOENT','EIO'].includes(e.code)?' ('+e.code+')':''));}
async function collect({dir=process.env.PAIRDESK_STATE_DIR||path.join(__dirname,'state'),request=()=>Fetch.markets(),now=Date.now,log=console.log}={}){
 const file=path.join(dir,'variational-history.json');let old={markets:{}};
 try{fs.mkdirSync(dir,{recursive:true,mode:0o700});if(fs.existsSync(file))old=JSON.parse(fs.readFileSync(file,'utf8'));}
 catch(e){throw diskError('Reading saved history',e);}
 if(!old||!old.markets||typeof old.markets!=='object'||Array.isArray(old.markets)||Object.values(old.markets).some(rows=>!Array.isArray(rows)))throw Fetch.failure('Saved history schema invalid; refusing to reset it');
 const markets=await request(),receivedAt=now();let next,counts;
 try{next=D.record(old,markets,receivedAt);counts=Object.keys(next.markets).map(id=>D.sampledHistory(next,id,receivedAt).length);}
 catch{throw Fetch.failure('Processing saved history or new marks failed');}
 const tmp=file+'.tmp';
 try{fs.writeFileSync(tmp,JSON.stringify(next),{mode:0o600});fs.renameSync(tmp,file);}
 catch(e){try{fs.unlinkSync(tmp);}catch{}throw diskError('Saving collected history',e);}
 // Receipt time determines the real bucket, even if a retry crosses a boundary.
 const bucket=new Date(Math.floor(receivedAt/300000)*300000).toISOString();
 log('Variational: recorded '+markets.filter(r=>r.tradfi&&r.price>0).length+' marks; longest history '+Math.max(0,...counts)+'/240 observations; received '+new Date(receivedAt).toISOString()+'; bucket '+bucket);
}
if(require.main===module)collect().catch(e=>{console.error('Variational collection failed: '+(e.safeMessage||'unexpected internal error')+'; prior history preserved.');process.exitCode=1;});
module.exports={collect};
