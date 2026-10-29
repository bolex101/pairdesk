#!/usr/bin/env python3
import getpass,json,os,pathlib,re,subprocess,tempfile,sys,shutil,time
if os.geteuid()!=0 or not sys.stdin.isatty(): sys.exit('Run interactively as root on the server.')
if len(sys.argv) not in (2,3) or sys.argv[1].lower() not in ('qfex','risex'):
 sys.exit('Usage: python3 setup-seven-wallets.py qfex|risex [APPROVED_FRIEND_ID]')
venue={'qfex':'QFEX','risex':'RISEx'}[sys.argv[1].lower()]
uid=sys.argv[2] if len(sys.argv)==3 else None
if uid and not re.fullmatch('[1-9][0-9]{0,15}',uid): sys.exit('Invalid friend ID.')
base=pathlib.Path('/opt/pairdesk');configfile=base/'wallet-config.json';statefile=pathlib.Path('/var/lib/pairdesk/positions.json')
def load():
 config=json.loads(configfile.read_text());state=json.loads(statefile.read_text())
 if uid:
  m=state.get('community',{}).get('members',{}).get(uid)
  if not m or m.get('status')!='approved': sys.exit('Friend must be approved first.')
  profile=m
 else: profile=None
 return config,state,profile
config,state,member=load()
target=member['wallets'].get(venue,{}) if uid else config.get(venue.lower(),{})
print('Configuring '+venue+' for '+('approved friend '+uid if uid else 'the bot owner')+'.')
if venue=='QFEX':
 print('Primary QFEX account only. Enable View positions and View orders only. Trading and transfers must be disabled.')
 if input('Confirm the key belongs to this profile and is view-only (type VIEW ONLY): ').strip()!='VIEW ONLY': sys.exit('Stopped.')
 key={'publicKey':getpass.getpass('QFEX public key (hidden): ').strip(),'secretKey':getpass.getpass('QFEX secret key (hidden): ').strip()}
 payload={'venue':venue,'key':key}
else:
 default=target.get('address') or (config.get('address','') if not uid else '')
 address=input('RISEx wallet address ['+default+']: ').strip() or default
 if not re.fullmatch('0x[a-fA-F0-9]{40}',address): sys.exit('Invalid address.')
 payload={'venue':venue,'address':address}
code="""let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>raw+=s);process.stdin.on('end',async()=>{try{const p=JSON.parse(raw);let a,result;if(p.venue==='QFEX'){const Q=require('/opt/pairdesk/qfex-wallet.cjs');a=await Q.fetchAccount({},p.key);if(!a.rows.length)await Q.executions(p.key);result={keyFingerprint:Q.fingerprint(p.key)};}else{a=await require('/opt/pairdesk/risex-wallet.cjs').fetchAccount(p.address);result={address:p.address};}console.log(JSON.stringify({...result,legs:a.rows.length,identified:a.rows.filter(r=>r.generation).length}));}catch(e){console.error('Validation failed: '+e.message);process.exitCode=1;}});"""
check=subprocess.run(['/opt/pairdesk/bin/node','-e',code],input=json.dumps(payload).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=110)
if check.returncode:
 print(check.stderr.decode());sys.exit('Nothing saved. Resolve the read-only validation error and rerun setup.')
verified=json.loads(check.stdout)
print('Verified '+str(verified['legs'])+' open legs; '+str(verified['identified'])+' with reconstructable entry times.')
settings={k:v for k,v in verified.items() if k not in ('legs','identified')};settings['enabled']=True
def safeguards(config,state,member):
 current=member['wallets'].get(venue,{}) if uid else config.get(venue.lower(),{})
 field='keyFingerprint' if venue=='QFEX' else 'address'
 other=settings[field]
 same=lambda a,b: str(a).lower()==str(b).lower()
 if current.get(field) and not same(current[field],other): raise RuntimeError('This profile already has a different account. Resolve its linked trades before replacing it.')
 candidates=[]
 if uid:
  candidates.append(config.get(venue.lower(),{}).get(field))
  if venue=='RISEx': candidates.extend([config.get('address'),config.get('phoenix',{}).get('address')])
 for fid,m in state.get('community',{}).get('members',{}).items():
  if fid==uid: continue
  if venue=='QFEX': candidates.append(m.get('wallets',{}).get('QFEX',{}).get(field))
  else: candidates.extend(w.get('address') for w in m.get('wallets',{}).values())
 if any(x and same(x,other) for x in candidates): raise RuntimeError('Account already belongs to another profile.')
safeguards(config,state,member)
folder=pathlib.Path('/etc/pairdesk');folder.mkdir(mode=0o700,exist_ok=True)
temp=None;name=('qfex-friend-'+uid if uid else 'qfex-key')
if venue=='QFEX':
 fd,temp=tempfile.mkstemp(prefix='.qfex-',dir=folder);os.close(fd);os.unlink(temp)
 result=subprocess.run(['systemd-creds','encrypt','--with-key=host','--name='+name,'-',temp],input=json.dumps(key).encode(),stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 if result.returncode:
  if os.path.exists(temp): os.unlink(temp)
  sys.exit('Credential encryption failed; nothing enabled.')
 os.chmod(temp,0o600)
active=subprocess.run(['systemctl','is-active','--quiet','pairdesk-monitor.service']).returncode==0
saved={}
def remember(file):
 saved[file]=(file.read_bytes(),file.stat()) if file.exists() else None
def atomic(file,data,mode=0o600):
 fd,t=tempfile.mkstemp(prefix='.pairdesk-',dir=file.parent)
 try:
  with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
  if file.exists():
   st=file.stat();os.chmod(t,st.st_mode&0o777);os.chown(t,st.st_uid,st.st_gid)
  else:os.chmod(t,mode)
  os.replace(t,file)
 finally:
  if os.path.exists(t):os.unlink(t)
try:
 subprocess.run(['systemctl','stop','pairdesk-monitor.service'],check=True)
 config,state,member=load();safeguards(config,state,member)
 destination=statefile if uid else configfile
 remember(destination)
 backup=folder/('wallet-setup-backup-'+str(time.time_ns())+'.json')
 backup.write_bytes(destination.read_bytes());os.chmod(backup,0o600)
 if venue=='QFEX':
  cred=folder/(name+'.cred');remember(cred)
  drop=pathlib.Path('/etc/systemd/system/pairdesk-monitor.service.d');drop.mkdir(exist_ok=True)
  conf=drop/(name+'.conf');remember(conf)
  os.replace(temp,cred);temp=None
  atomic(conf,('[Service]\nLoadCredentialEncrypted='+name+':/etc/pairdesk/'+name+'.cred\n').encode(),0o644)
 if uid:
  member['wallets'][venue]=settings;member['epoch']=member.get('epoch',0)+1
  atomic(statefile,json.dumps(state).encode())
 else:
  config[venue.lower()]=settings;config['enabled']=True
  atomic(configfile,json.dumps(config).encode(),0o644)
 subprocess.run(['systemctl','daemon-reload'],check=True)
 if active:subprocess.run(['systemctl','start','pairdesk-monitor.service'],check=True)
except BaseException:
 for f,old in saved.items():
  if old is None:
   if f.exists():f.unlink()
  else:
   atomic(f,old[0]);os.chmod(f,old[1].st_mode&0o777);os.chown(f,old[1].st_uid,old[1].st_gid)
 subprocess.run(['systemctl','daemon-reload'])
 if active:subprocess.run(['systemctl','start','pairdesk-monitor.service'])
 raise
finally:
 if temp and os.path.exists(temp):os.unlink(temp)
print(venue+' tracking enabled. Check /wallets and /positions privately after two monitor cycles.')
