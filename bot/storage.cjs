const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function save(file,value){const temp=file+'.tmp',fd=fs.openSync(temp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);}
function signal(dir,plan){const folder=path.join(dir,'signals');fs.mkdirSync(folder,{recursive:true,mode:0o700});const id=crypto.randomBytes(6).toString('hex');fs.writeFileSync(path.join(folder,id+'.json'),JSON.stringify(plan),{flag:'wx',mode:0o600});return id;}
function loadSignal(dir,id){if(!/^[a-f0-9]{12}$/.test(id))return null;try{return JSON.parse(fs.readFileSync(path.join(dir,'signals',id+'.json'),'utf8'));}catch{return null;}}
module.exports={save,signal,loadSignal};
