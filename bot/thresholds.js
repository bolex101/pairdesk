(function(root){
/* Single source of research/monitoring thresholds, shared by the bot and the dashboard.
   Override on the server with bot/pairdesk-config.json or PAIRDESK_CONFIG (see config.cjs). */
const DEFAULTS=Object.freeze({
 minAlertScore:65,          // Telegram alert score floor (0-100)
 minConfirmZ:1.0,           // 15-minute confirmation |z| floor, same sign as 5-minute z
 entryZMin:1.5,entryZMax:3, // 5-minute |z| entry band
 slippageBps:3,             // per-side slippage allowance used in cost
 minBars:240,               // 5-minute bars required (20h)
 fitWindow:120,             // bars used for beta, sd, z, half-life and ADF
 adfLags:1,adfLevel:0.10,   // Engle-Granger ADF gate; adfLevel null disables
 minHalfLife:5,maxHalfLife:120, // minutes
 minCorrelation:0.5,minHalfCorrelation:0.3,
 maxQuoteAgeMs:120000,
 fundingIncomeCreditMax:0.5,requireKnownFunding:false,
 liquidationAlertPct:15,hedgeDriftAlertPct:10,
 heartbeatStaleMinutes:30,
 fundingIntervalSeconds:Object.freeze({Arcus:null,Ondo:null,Popdex:null})
});
let current={...DEFAULTS};
const num=(k,lo,hi)=>v=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi||k+' must be a number between '+lo+' and '+hi;
const RULES={minAlertScore:num('minAlertScore',0,100),minConfirmZ:num('minConfirmZ',0,10),entryZMin:num('entryZMin',0,10),entryZMax:num('entryZMax',0,20),slippageBps:num('slippageBps',0,100),
 minBars:v=>Number.isInteger(v)&&v>=60&&v<=2000||'minBars must be an integer 60-2000',fitWindow:v=>Number.isInteger(v)&&v>=30&&v<=2000||'fitWindow must be an integer 30-2000',
 adfLags:v=>Number.isInteger(v)&&v>=0&&v<=12||'adfLags must be an integer 0-12',adfLevel:v=>v===null||[0.01,0.05,0.1].includes(v)||'adfLevel must be 0.01, 0.05, 0.10 or null',
 minHalfLife:num('minHalfLife',0,10000),maxHalfLife:num('maxHalfLife',0,10000),minCorrelation:num('minCorrelation',-1,1),minHalfCorrelation:num('minHalfCorrelation',-1,1),
 maxQuoteAgeMs:num('maxQuoteAgeMs',1000,3600000),fundingIncomeCreditMax:num('fundingIncomeCreditMax',0,1),requireKnownFunding:v=>typeof v==='boolean'||'requireKnownFunding must be true/false',
 liquidationAlertPct:num('liquidationAlertPct',0.1,99),hedgeDriftAlertPct:num('hedgeDriftAlertPct',0.1,99),heartbeatStaleMinutes:num('heartbeatStaleMinutes',1,1440),
 fundingIntervalSeconds:v=>v&&typeof v==='object'&&Object.entries(v).every(([k,s])=>typeof k==='string'&&(s===null||Number.isFinite(s)&&s>0&&s<=86400*7))||'fundingIntervalSeconds must map venue to seconds or null'};
function validate(o){
 if(!o||typeof o!=='object'||Array.isArray(o))throw Error('Thresholds must be an object');
 for(const [k,v] of Object.entries(o)){if(!RULES[k])throw Error('Unknown threshold: '+k);const r=RULES[k](v);if(r!==true)throw Error(r);}
 const m={...DEFAULTS,...o};
 if(m.entryZMin>=m.entryZMax)throw Error('entryZMin must be below entryZMax');
 if(m.minHalfLife>=m.maxHalfLife)throw Error('minHalfLife must be below maxHalfLife');
 if(m.fitWindow>=m.minBars)throw Error('fitWindow must be below minBars');
 return m;
}
function set(o={}){current=validate(o);current.fundingIntervalSeconds={...DEFAULTS.fundingIntervalSeconds,...(o.fundingIntervalSeconds||{})};return current;}
function get(){return current;}
root.PairThresholds={DEFAULTS,validate,set,get};if(typeof module!=='undefined')module.exports=root.PairThresholds;
})(typeof globalThis!=='undefined'?globalThis:this);
