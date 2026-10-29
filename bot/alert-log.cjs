// Append-only, machine-readable record of every delivered alert (one JSON object per line),
// so outcomes reported by the trader can be matched later. No secrets are written.
const fs=require('node:fs'),path=require('node:path');
function file(dir){return process.env.PAIRDESK_ALERT_LOG||path.join(dir,'alerts-log.jsonl');}
function entry(a,signalId,now=Date.now()){
 const p=a.plan||{},pair=a.pair||{},leg=l=>l&&{id:l.id,side:l.side,entry:l.entry,notional:l.notional,units:l.units,quoteTime:l.quoteTime};
 return {time:new Date(now).toISOString(),signalId,venue:a.venue,pair:pair.a?.id+'/'+pair.b?.id,side:a.side,score:pair.score,z:pair.z,planZ:p.z,
  beta:p.beta,alpha:p.alpha,sd:p.sd,halfLifeMin:pair.half,adfP:pair.adf?.p??null,a:leg(p.a),b:leg(p.b),gross:p.gross,
  tpZ:p.tpZ,stopZ:p.stopZ,tpRatio:p.ratios?.tp,stopRatio:p.ratios?.stop,entryRatio:p.ratios?.entry,
  maxHoldMinutes:p.maxHoldMinutes,timeExitAt:Number.isFinite(p.createdAt)&&Number.isFinite(p.maxHoldMinutes)?new Date(p.createdAt+p.maxHoldMinutes*60000).toISOString():null,
  entryValidUntil:Number.isFinite(p.expiresAt)?new Date(p.expiresAt).toISOString():null,
  costUsd:p.cost,fundingUsd:p.funding?.usd??null,fundingKnown:!!p.funding?.known,targetNetUsd:p.targetNet,stopLossUsd:p.stopLoss};
}
function append(dir,a,signalId,now=Date.now()){const f=file(dir);fs.mkdirSync(path.dirname(f),{recursive:true,mode:0o700});fs.appendFileSync(f,JSON.stringify(entry(a,signalId,now))+'\n',{mode:0o600});return f;}
module.exports={file,entry,append};
